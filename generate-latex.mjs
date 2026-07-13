#!/usr/bin/env node

/**
 * generate-latex.mjs -- Validate and compile a generated .tex CV file to PDF.
 *
 * Usage:
 *   node generate-latex.mjs <input.tex> [output.pdf]
 *   node generate-latex.mjs --engine=xelatex --expect-pages=1 --ats-text-check <input.tex> [output.pdf]
 *
 * The default path is unchanged: validate the career-ops CV template, compile
 * with the first available engine from auto mode, and write a sibling PDF when
 * output.pdf is omitted.
 */

import { readFile, writeFile, stat, copyFile, rm } from 'fs/promises';
import { resolve, basename, dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

const MIN_SECTIONS = 4;
const REQUIRED_COMMANDS = [
  '\\\\resumeSubheading',
  '\\\\resumeItem',
  '\\\\resumeProjectHeading',
];
const ALLOWED_ENGINES = new Set(['auto', 'tectonic', 'pdflatex', 'lualatex', 'xelatex']);
const AUTO_ENGINE_ORDER = ['tectonic', 'pdflatex', 'lualatex', 'xelatex'];
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/u;

function usage() {
  return `Usage:
  node generate-latex.mjs [--engine=auto|tectonic|pdflatex|lualatex|xelatex] [--expect-pages=N] [--ats-text-check] <input.tex> [output.pdf]`;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    engine: 'auto',
    expectPages: null,
    atsTextCheck: false,
    help: false,
    inputPath: null,
    outputPath: null,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--ats-text-check') {
      options.atsTextCheck = true;
    } else if (arg.startsWith('--engine=')) {
      options.engine = arg.slice('--engine='.length);
    } else if (arg === '--engine') {
      options.engine = argv[++i];
    } else if (arg.startsWith('--expect-pages=')) {
      options.expectPages = Number.parseInt(arg.slice('--expect-pages='.length), 10);
    } else if (arg === '--expect-pages') {
      options.expectPages = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!ALLOWED_ENGINES.has(options.engine)) {
    throw new Error(`Invalid --engine value "${options.engine}". Expected one of: ${[...ALLOWED_ENGINES].join(', ')}`);
  }
  if (options.expectPages !== null && (!Number.isInteger(options.expectPages) || options.expectPages < 1)) {
    throw new Error('--expect-pages must be a positive integer');
  }
  if (positional.length > 2) {
    throw new Error(`Too many positional arguments: ${positional.slice(2).join(' ')}`);
  }

  options.inputPath = positional[0] || null;
  options.outputPath = positional[1] || null;
  return options;
}

export function resolveEngineCandidates(requested = 'auto') {
  if (requested === 'auto') return [...AUTO_ENGINE_ORDER];
  if (!ALLOWED_ENGINES.has(requested) || requested === 'auto') return [...AUTO_ENGINE_ORDER];
  return [requested];
}

function executableExists(candidate) {
  try {
    execFileSync(candidate, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function selectEngine(requested) {
  for (const candidate of resolveEngineCandidates(requested)) {
    if (executableExists(candidate)) return candidate;
  }
  return null;
}

export function parsePdfInfoPages(output) {
  const match = String(output || '').match(/^\s*Pages:\s*(\d+)\s*$/mi);
  return match ? Number.parseInt(match[1], 10) : null;
}

function countPdfPagesHeuristic(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

async function readPdfPageCount(pdfPath) {
  try {
    const output = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const pages = parsePdfInfoPages(output);
    if (pages) return { pages, method: 'pdfinfo' };
  } catch {
    // Fall back below. pdfinfo is part of Poppler and may not be installed.
  }

  try {
    const buffer = await readFile(pdfPath);
    const pages = countPdfPagesHeuristic(buffer);
    if (pages) return { pages, method: 'pdf-heuristic' };
  } catch {
    // Report skipped below.
  }

  return { pages: null, method: null };
}

export function findAtsTextLayerIssues(text) {
  const value = String(text || '');
  const issues = [];
  if (!value.trim()) issues.push('pdftotext extracted no text');
  if (/\(cid:\d+\)/i.test(value)) issues.push('pdftotext found CID glyph fallbacks');
  if (value.includes('\uFFFD')) issues.push('pdftotext found replacement characters');
  return issues;
}

function runPdfToText(pdfPath) {
  try {
    const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { checked: true, skipped: false, issues: findAtsTextLayerIssues(text) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        checked: false,
        skipped: true,
        warning: 'pdftotext not found; ATS text-layer check skipped',
        issues: [],
      };
    }
    return {
      checked: false,
      skipped: false,
      warning: `pdftotext failed: ${err.message}`,
      issues: [`pdftotext failed: ${err.message}`],
    };
  }
}

function latexArgs(engine, texDir, texPath) {
  if (engine === 'tectonic') return ['--outdir', texDir, texPath];
  return [
    '-no-shell-escape',
    '-interaction=nonstopmode',
    '-halt-on-error',
    `-output-directory=${texDir}`,
    texPath,
  ];
}

async function validateLatex(absPath, content, requestedEngine) {
  const issues = [];

  const sectionCount = (content.match(/\\section\{/g) || []).length;
  if (sectionCount < MIN_SECTIONS) {
    issues.push(`Expected at least ${MIN_SECTIONS} \\section{} blocks (Education, Work Experience, Projects, Skills or localized equivalents), found ${sectionCount}`);
  }

  if (CJK_RE.test(content) && ['auto', 'tectonic', 'pdflatex'].includes(requestedEngine)) {
    issues.push('CJK characters detected. Use --engine=lualatex or --engine=xelatex with a CJK-capable template, or use pdf mode (HTML to PDF).');
  }

  for (const cmd of REQUIRED_COMMANDS) {
    if (!new RegExp(cmd).test(content)) issues.push(`Missing command: ${cmd}`);
  }

  if (!content.includes('\\begin{document}')) issues.push('Missing \\begin{document}');
  if (!content.includes('\\end{document}')) issues.push('Missing \\end{document}');

  const unresolvedMatch = content.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolvedMatch) {
    issues.push(`Unresolved placeholders: ${[...new Set(unresolvedMatch)].join(', ')}`);
  }

  if (!content.includes('\\pdfgentounicode=1') && !['lualatex', 'xelatex'].includes(requestedEngine)) {
    issues.push('Missing \\pdfgentounicode=1 (ATS compatibility)');
  }

  const lines = content.split('\n');
  let resumeItemCount = 0;
  let subheadingCount = 0;
  let projectHeadingCount = 0;

  for (const line of lines) {
    if (/\\resumeItem\{/.test(line)) resumeItemCount += 1;
    if (/\\resumeSubheading[^C]/.test(line)) subheadingCount += 1;
    if (/\\resumeProjectHeading/.test(line)) projectHeadingCount += 1;
  }

  const fileInfo = await stat(absPath);
  return {
    file: basename(absPath),
    path: absPath,
    sizeKB: parseFloat((fileInfo.size / 1024).toFixed(1)),
    counts: {
      resumeItems: resumeItemCount,
      subheadings: subheadingCount,
      projectHeadings: projectHeadingCount,
    },
    issues,
    valid: issues.length === 0,
  };
}

async function main() {
  let options;
  try {
    options = parseCliArgs();
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }

  if (options.help || !options.inputPath) {
    console.error(usage());
    process.exit(options.help ? 0 : 1);
  }

  const absPath = resolve(options.inputPath);
  let content;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading ${absPath}: ${err.message}`);
    process.exit(1);
  }

  const report = await validateLatex(absPath, content, options.engine);
  report.options = {
    engine: options.engine,
    expectPages: options.expectPages,
    atsTextCheck: options.atsTextCheck,
  };

  if (report.issues.length > 0) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const texDir = dirname(absPath);
  const texBase = basename(absPath, '.tex');
  const defaultPdf = join(texDir, `${texBase}.pdf`);
  const targetPdf = options.outputPath ? resolve(options.outputPath) : defaultPdf;

  const targetDir = dirname(targetPdf);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const engine = selectEngine(options.engine);
  if (!engine) {
    report.compiled = false;
    report.compileError = `No LaTeX engine found for --engine=${options.engine}. Install tectonic, pdflatex, lualatex, or xelatex.`;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  report.engine = engine;

  let compilePath = absPath;
  if (engine === 'tectonic') {
    const patched = content
      .replace(/\\pdfgentounicode\s*=\s*\d+[^\n]*\n?/g, '')
      .replace(/\\input\{glyphtounicode\}[^\n]*\n?/g, '');
    compilePath = join(texDir, `${texBase}._tectonic.tex`);
    await writeFile(compilePath, patched, 'utf-8');
  }

  const compileBase = basename(compilePath, '.tex');

  try {
    if (engine === 'tectonic') {
      execFileSync(engine, latexArgs(engine, texDir, compilePath), {
        cwd: texDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } else {
      const args = latexArgs(engine, texDir, absPath);
      execFileSync(engine, args, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
      execFileSync(engine, args, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
    }
    report.compiled = true;
  } catch (err) {
    const logPath = join(texDir, `${texBase}.log`);
    let latexError = err.message;
    try {
      const log = await readFile(logPath, 'utf-8');
      const errorLines = log.split('\n').filter(l => l.startsWith('!'));
      if (errorLines.length > 0) latexError = errorLines.join('\n');
    } catch {
      // no log file
    }
    report.compiled = false;
    report.compileError = latexError;
  }

  if (report.compiled) {
    const compiledPdf = join(texDir, `${compileBase}.pdf`);
    try {
      if (resolve(compiledPdf) !== resolve(targetPdf)) {
        await copyFile(compiledPdf, targetPdf);
        await rm(compiledPdf).catch(() => {});
      }

      const pdfStat = await stat(targetPdf);
      report.pdf = {
        path: targetPdf,
        sizeKB: parseFloat((pdfStat.size / 1024).toFixed(1)),
      };
    } catch (err) {
      report.postCompileError = `Failed to finalize PDF: ${err.message}`;
    }

    if (!report.postCompileError && options.expectPages !== null) {
      const pageInfo = await readPdfPageCount(targetPdf);
      report.pageCheck = {
        expected: options.expectPages,
        actual: pageInfo.pages,
        method: pageInfo.method,
        passed: pageInfo.pages === options.expectPages,
      };
      if (!report.pageCheck.passed) {
        report.pageCheck.error = pageInfo.pages === null
          ? 'Could not determine PDF page count'
          : `Expected ${options.expectPages} page(s), found ${pageInfo.pages}`;
      }
    }

    if (!report.postCompileError && options.atsTextCheck) {
      report.atsText = runPdfToText(targetPdf);
    }

    const auxExts = ['.aux', '.log', '.out', '.fls', '.fdb_latexmk', '.synctex.gz'];
    for (const ext of auxExts) {
      await rm(join(texDir, `${compileBase}${ext}`)).catch(() => {});
      if (compileBase !== texBase) await rm(join(texDir, `${texBase}${ext}`)).catch(() => {});
    }
    if (engine === 'tectonic') await rm(compilePath).catch(() => {});
  }

  const pageCheckOk = !report.pageCheck || report.pageCheck.passed;
  const atsOk = !report.atsText || report.atsText.skipped || report.atsText.issues.length === 0;
  const ok = report.compiled && !report.postCompileError && pageCheckOk && atsOk;

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
