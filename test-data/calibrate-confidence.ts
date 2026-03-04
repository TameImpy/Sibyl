/**
 * POC-010: Confidence Threshold Calibration Script
 *
 * Reads a completed validation results file and computes precision@confidence.
 * Identifies the lowest confidence threshold that yields ≥85% precision.
 *
 * Usage:
 *   npx ts-node test-data/calibrate-confidence.ts \
 *     --results test-data/validation-results-2026-03-01T12-00-00.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types (matching run-poc-validation.ts output)
// ---------------------------------------------------------------------------

interface TagResult {
  tag: string;
  confidence: number;
  reasoning?: string;
}

interface GroundTruth {
  expected_vertical: string;
  expected_tags: string[];
  min_expected: string[];
  reject_tags: string[];
  notes: string;
}

interface ItemResult {
  id: string;
  contentId: string;
  contentType: string;
  status: 'completed' | 'failed' | 'timeout';
  tags: TagResult[];
  groundTruth: GroundTruth;
  metrics: {
    minPrecision: number;
  };
}

interface ValidationReport {
  runAt: string;
  summary: {
    accuracy: {
      minExpectedPrecision: number;
    };
  };
  itemResults: ItemResult[];
}

interface ConfidenceBin {
  range: string;
  minConfidence: number;
  maxConfidence: number;
  totalTags: number;
  correctTags: number;
  precision: number | null;
}

interface CalibrationReport {
  sourceFile: string;
  validationRunAt: string;
  currentThreshold: number;
  recommendedThreshold: number | null;
  thresholdAnalysis: string;
  bins: ConfidenceBin[];
  tagDecisions: Array<{
    itemId: string;
    tag: string;
    confidence: number;
    isCorrect: boolean;
    isInExpected: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { resultsFile: string } {
  const args = process.argv.slice(2);
  const resultsIndex = args.indexOf('--results');
  if (resultsIndex === -1 || !args[resultsIndex + 1]) {
    console.error('Usage: npx ts-node calibrate-confidence.ts --results <results-file>');
    process.exit(1);
  }
  return { resultsFile: args[resultsIndex + 1] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { resultsFile } = parseArgs();
  const resolvedPath = path.isAbsolute(resultsFile)
    ? resultsFile
    : path.join(process.cwd(), resultsFile);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Results file not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Reading results from: ${resolvedPath}`);
  const report: ValidationReport = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

  // Collect all individual tag decisions for completed items with expected_tags
  const tagDecisions: CalibrationReport['tagDecisions'] = [];

  for (const item of report.itemResults) {
    if (item.status !== 'completed') continue;
    if (item.groundTruth.expected_tags.length === 0) continue;

    for (const tag of item.tags) {
      tagDecisions.push({
        itemId: item.id,
        tag: tag.tag,
        confidence: tag.confidence,
        isCorrect: item.groundTruth.expected_tags.includes(tag.tag),
        isInExpected: item.groundTruth.expected_tags.includes(tag.tag),
      });
    }
  }

  if (tagDecisions.length === 0) {
    console.error('No tag decisions found in results file. Cannot calibrate.');
    process.exit(1);
  }

  console.log(`Analyzing ${tagDecisions.length} tag decisions across ${report.itemResults.filter((r) => r.status === 'completed').length} completed items`);
  console.log('');

  // Build confidence bins in 10% increments
  const CURRENT_THRESHOLD = 0.85;
  const NUM_BINS = 10;
  const bins: ConfidenceBin[] = [];

  for (let i = 0; i < NUM_BINS; i++) {
    const minConf = i / NUM_BINS;
    const maxConf = (i + 1) / NUM_BINS;

    const tagsInBin = tagDecisions.filter(
      (d) => d.confidence >= minConf && (i === NUM_BINS - 1 ? d.confidence <= maxConf : d.confidence < maxConf)
    );

    const correct = tagsInBin.filter((d) => d.isCorrect).length;
    const total = tagsInBin.length;

    bins.push({
      range: `${(minConf * 100).toFixed(0)}%-${(maxConf * 100).toFixed(0)}%`,
      minConfidence: minConf,
      maxConfidence: maxConf,
      totalTags: total,
      correctTags: correct,
      precision: total > 0 ? correct / total : null,
    });
  }

  // Find recommended threshold: lowest confidence where all bins above have precision ≥ 85%
  // Work from highest confidence down to find where precision drops below 85%
  let recommendedThreshold: number | null = null;
  for (let i = NUM_BINS - 1; i >= 0; i--) {
    const bin = bins[i];
    if (bin.precision === null) continue; // empty bin

    // Check if this bin AND all bins above it have precision ≥ 85%
    const binsAbove = bins.slice(i);
    const allAboveMeetThreshold = binsAbove.every(
      (b) => b.precision === null || b.precision >= 0.85
    );

    if (allAboveMeetThreshold) {
      recommendedThreshold = bin.minConfidence;
    } else {
      break;
    }
  }

  // If we found a threshold, see if we can lower it further
  // (walk up from lowest bin to find where we first hit 85%)
  if (recommendedThreshold === null) {
    // Start from highest bin and work down until precision drops below 85%
    for (let i = NUM_BINS - 1; i >= 0; i--) {
      const binsFrom = bins.slice(i);
      const allMeet = binsFrom.every((b) => b.precision === null || b.precision >= 0.85);
      if (allMeet && bins[i].precision !== null) {
        recommendedThreshold = bins[i].minConfidence;
      } else if (bins[i].precision !== null && bins[i].precision! < 0.85) {
        break;
      }
    }
  }

  const thresholdAnalysis = recommendedThreshold !== null
    ? recommendedThreshold < CURRENT_THRESHOLD
      ? `Threshold could be LOWERED to ${(recommendedThreshold * 100).toFixed(0)}% (from ${(CURRENT_THRESHOLD * 100).toFixed(0)}%) — increases auto-publish rate while maintaining ≥85% precision`
      : recommendedThreshold > CURRENT_THRESHOLD
        ? `Current threshold should be RAISED to ${(recommendedThreshold * 100).toFixed(0)}% — current ${(CURRENT_THRESHOLD * 100).toFixed(0)}% threshold yields precision below 85% for some bins`
        : `Current threshold of ${(CURRENT_THRESHOLD * 100).toFixed(0)}% is well-calibrated`
    : 'Could not determine recommended threshold — insufficient data in confidence bins';

  // ASCII table output
  console.log('PRECISION BY CONFIDENCE BIN');
  console.log('─'.repeat(60));
  console.log(`${'Bin'.padEnd(12)} ${'Tags'.padStart(6)} ${'Correct'.padStart(8)} ${'Precision'.padStart(10)}`);
  console.log('─'.repeat(60));

  for (const bin of bins) {
    const precStr = bin.precision !== null ? `${(bin.precision * 100).toFixed(1)}%` : 'N/A (empty)';
    const marker =
      bin.minConfidence >= CURRENT_THRESHOLD
        ? ' ← current threshold'
        : bin.precision !== null && bin.precision >= 0.85
          ? ' ✓'
          : bin.precision !== null && bin.precision < 0.85
            ? ' ✗'
            : '';

    console.log(
      `${bin.range.padEnd(12)} ${String(bin.totalTags).padStart(6)} ${String(bin.correctTags).padStart(8)} ${precStr.padStart(10)}${marker}`
    );
  }

  console.log('─'.repeat(60));
  console.log('');
  console.log(`Current threshold:     ${(CURRENT_THRESHOLD * 100).toFixed(0)}%`);
  console.log(
    `Recommended threshold: ${recommendedThreshold !== null ? `${(recommendedThreshold * 100).toFixed(0)}%` : 'N/A'}`
  );
  console.log('');
  console.log(`Analysis: ${thresholdAnalysis}`);
  console.log('');

  // Write calibration report
  const calibrationReport: CalibrationReport = {
    sourceFile: resolvedPath,
    validationRunAt: report.runAt,
    currentThreshold: CURRENT_THRESHOLD,
    recommendedThreshold,
    thresholdAnalysis,
    bins,
    tagDecisions,
  };

  const outPath = resolvedPath.replace('.json', '-calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(calibrationReport, null, 2));
  console.log(`Calibration report written to: ${outPath}`);
}

main();
