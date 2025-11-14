/**
 * Report Generator
 * Generate benchmark reports in Markdown and JSON formats
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import type { BenchmarkReport } from '../types.js';

export class ReportGenerator {
  /**
   * Generate and save reports
   * @param report Benchmark report data
   * @param outputDir Output directory for reports
   */
  generateReports(report: BenchmarkReport, outputDir: string = '.'): {
    markdownPath: string;
    jsonPath: string;
  } {
    const timestamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-');
    const markdownPath = resolve(outputDir, `benchmark-report-${timestamp}.md`);
    const jsonPath = resolve(outputDir, `benchmark-report-${timestamp}.json`);

    // Generate Markdown report
    const markdown = this.generateMarkdown(report);
    writeFileSync(markdownPath, markdown, 'utf-8');

    // Generate JSON report
    const json = JSON.stringify(report, null, 2);
    writeFileSync(jsonPath, json, 'utf-8');

    return { markdownPath, jsonPath };
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# Memento MCP Benchmark Report');
    lines.push('');
    lines.push(`**Timestamp:** ${new Date(report.timestamp).toLocaleString()}`);
    lines.push(`**Model:** ${report.config.model}`);
    lines.push(`**Facts:** ${report.config.factsCount}`);
    lines.push(`**Questions:** ${report.config.questionsCount}`);
    lines.push('');

    // Executive Summary
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`**Overall Score:** ${report.evaluation.summary.averageScore.toFixed(2)}/100`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Average Accuracy | ${report.evaluation.summary.averageAccuracy.toFixed(2)}% |`);
    lines.push(
      `| Average Completeness | ${report.evaluation.summary.averageCompleteness.toFixed(2)}% |`
    );
    lines.push(
      `| Successful Questions | ${report.evaluation.summary.successfulQuestions}/${report.evaluation.summary.totalQuestions} |`
    );
    lines.push(`| Total Duration | ${(report.performance.totalDuration / 1000).toFixed(2)}s |`);
    lines.push('');

    // Performance Breakdown
    lines.push('## Performance Breakdown');
    lines.push('');
    lines.push('| Phase | Duration |');
    lines.push('|-------|----------|');
    lines.push(`| Ingest | ${(report.performance.ingestDuration / 1000).toFixed(2)}s |`);
    lines.push(`| Retrieval | ${(report.performance.retrievalDuration / 1000).toFixed(2)}s |`);
    lines.push(`| Evaluation | ${(report.performance.evaluationDuration / 1000).toFixed(2)}s |`);
    lines.push('');

    // Ingest Phase Results
    lines.push('## Ingest Phase Results');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Facts Processed | ${report.ingest.factsProcessed} |`);
    lines.push(`| Entities Created | ${report.ingest.entitiesCreated} |`);
    lines.push(`| Relations Created | ${report.ingest.relationsCreated} |`);
    lines.push(`| Observations Added | ${report.ingest.observationsAdded} |`);
    lines.push(`| Errors | ${report.ingest.errors.length} |`);
    lines.push('');

    if (report.ingest.errors.length > 0) {
      lines.push('### Ingest Errors');
      lines.push('');
      report.ingest.errors.forEach((error, i) => {
        lines.push(`${i + 1}. ${error}`);
      });
      lines.push('');
    }

    // Question-by-Question Results
    lines.push('## Question-by-Question Results');
    lines.push('');

    report.evaluation.results.forEach((result, index) => {
      lines.push(`### ${index + 1}. ${result.questionId}`);
      lines.push('');
      lines.push(`**Question:** ${result.question}`);
      lines.push('');
      lines.push(`**Score:** ${result.score.toFixed(2)}/100 (Accuracy: ${result.accuracy.toFixed(2)}, Completeness: ${result.completeness.toFixed(2)})`);
      lines.push('');
      lines.push('**Gold Answer:**');
      lines.push('```');
      lines.push(result.goldAnswer);
      lines.push('```');
      lines.push('');
      lines.push('**Retrieved Answer:**');
      lines.push('```');
      lines.push(result.retrievedAnswer || '(No answer retrieved)');
      lines.push('```');
      lines.push('');
      lines.push(`**Evaluation Notes:** ${result.notes}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    // API Statistics
    lines.push('## API Statistics');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Total Requests | ${report.apiStats.totalRequests} |`);
    lines.push(`| Successful Requests | ${report.apiStats.successfulRequests} |`);
    lines.push(`| Failed Requests | ${report.apiStats.failedRequests} |`);
    lines.push(`| Retries | ${report.apiStats.retries} |`);
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Generated by Memento MCP Benchmark System*');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Print summary to console
   */
  printSummary(report: BenchmarkReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(80));
    console.log(`Model: ${report.config.model}`);
    console.log(`Timestamp: ${new Date(report.timestamp).toLocaleString()}`);
    console.log('');
    console.log(`Overall Score: ${report.evaluation.summary.averageScore.toFixed(2)}/100`);
    console.log(`  - Accuracy:     ${report.evaluation.summary.averageAccuracy.toFixed(2)}%`);
    console.log(`  - Completeness: ${report.evaluation.summary.averageCompleteness.toFixed(2)}%`);
    console.log('');
    console.log(
      `Success Rate: ${report.evaluation.summary.successfulQuestions}/${report.evaluation.summary.totalQuestions} ` +
        `(${((report.evaluation.summary.successfulQuestions / report.evaluation.summary.totalQuestions) * 100).toFixed(1)}%)`
    );
    console.log('');
    console.log(`Total Duration: ${(report.performance.totalDuration / 1000).toFixed(2)}s`);
    console.log(`  - Ingest:     ${(report.performance.ingestDuration / 1000).toFixed(2)}s`);
    console.log(`  - Retrieval:  ${(report.performance.retrievalDuration / 1000).toFixed(2)}s`);
    console.log(`  - Evaluation: ${(report.performance.evaluationDuration / 1000).toFixed(2)}s`);
    console.log('');
    console.log(`API Requests: ${report.apiStats.totalRequests} total, ${report.apiStats.failedRequests} failed, ${report.apiStats.retries} retries`);
    console.log('='.repeat(80));
  }
}
