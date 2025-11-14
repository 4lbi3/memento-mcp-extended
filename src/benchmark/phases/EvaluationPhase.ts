/**
 * Phase 3: Evaluation
 * Use LLM to evaluate retrieved answers against gold answers
 */
import type { LLMClient } from '../llm/LLMClient.js';
import type { Question, RetrievalResult, EvaluationResult } from '../types.js';

const EVALUATION_SYSTEM_PROMPT = `You are an expert evaluator assessing the quality of answers from a knowledge graph system.

Your task is to evaluate a retrieved answer against a gold standard answer and assign scores.

Evaluate the following aspects:
1. ACCURACY: How factually correct is the retrieved answer compared to the gold answer? (0-100)
2. COMPLETENESS: How much of the gold answer's information is covered? (0-100)

Consider:
- The retrieved answer may be phrased differently but still be correct
- Focus on factual correctness, not phrasing
- Partial information should get partial credit
- Missing information should reduce completeness score

Return your evaluation in the following JSON format:
{
  "accuracy": <0-100>,
  "completeness": <0-100>,
  "notes": "<brief explanation of your scoring>"
}

IMPORTANT: Return ONLY valid JSON, no additional text or explanations.`;

export class EvaluationPhase {
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * Run the evaluation phase
   * @param questions Array of questions with gold answers
   * @param retrievalResults Array of retrieval results
   * @returns Array of evaluation results
   */
  async run(questions: Question[], retrievalResults: RetrievalResult[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    console.log(`\n[Evaluation Phase] Starting evaluation of ${retrievalResults.length} answers...`);

    for (let i = 0; i < retrievalResults.length; i++) {
      const retrieval = retrievalResults[i];
      const question = questions.find((q) => q.id === retrieval.questionId);

      if (!question) {
        console.error(`[Evaluation Phase] ✗ Question not found for ID: ${retrieval.questionId}`);
        continue;
      }

      console.log(`[Evaluation Phase] Evaluating ${i + 1}/${retrievalResults.length}: ${question.id}`);

      try {
        const result = await this.evaluateAnswer(question, retrieval);
        results.push(result);
        console.log(
          `[Evaluation Phase] ✓ Score: ${result.score.toFixed(1)}/100 ` +
            `(Accuracy: ${result.accuracy.toFixed(1)}, Completeness: ${result.completeness.toFixed(1)})`
        );
      } catch (error) {
        console.error(`[Evaluation Phase] ✗ Failed to evaluate: ${(error as Error).message}`);
        // Add a default failed evaluation
        results.push({
          questionId: question.id,
          question: question.question,
          goldAnswer: question.goldAnswer,
          retrievedAnswer: retrieval.retrievedAnswer,
          score: 0,
          accuracy: 0,
          completeness: 0,
          notes: `Evaluation failed: ${(error as Error).message}`,
          duration: 0,
        });
      }

      // Small delay between evaluations
      if (i < retrievalResults.length - 1) {
        await this.sleep(500);
      }
    }

    console.log(`[Evaluation Phase] Completed ${results.length} evaluations`);
    return results;
  }

  /**
   * Evaluate a single answer
   */
  private async evaluateAnswer(
    question: Question,
    retrieval: RetrievalResult
  ): Promise<EvaluationResult> {
    const startTime = Date.now();

    // Handle case where retrieval failed
    if (retrieval.error) {
      return {
        questionId: question.id,
        question: question.question,
        goldAnswer: question.goldAnswer,
        retrievedAnswer: retrieval.retrievedAnswer,
        score: 0,
        accuracy: 0,
        completeness: 0,
        notes: `Retrieval failed: ${retrieval.error}`,
        duration: Date.now() - startTime,
      };
    }

    // Ask LLM to evaluate
    const userPrompt = `Question: "${question.question}"

Gold Answer (expected):
"${question.goldAnswer}"

Retrieved Answer (from system):
"${retrieval.retrievedAnswer}"

Evaluate the retrieved answer against the gold answer. Return only valid JSON.`;

    const response = await this.llmClient.prompt(EVALUATION_SYSTEM_PROMPT, userPrompt, 700);

    // Parse evaluation
    const evaluation = this.parseEvaluation(response.content);

    // Calculate overall score as average of accuracy and completeness
    const score = (evaluation.accuracy + evaluation.completeness) / 2;

    return {
      questionId: question.id,
      question: question.question,
      goldAnswer: question.goldAnswer,
      retrievedAnswer: retrieval.retrievedAnswer,
      score,
      accuracy: evaluation.accuracy,
      completeness: evaluation.completeness,
      notes: evaluation.notes,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Parse evaluation from LLM response
   */
  private parseEvaluation(content: string): {
    accuracy: number;
    completeness: number;
    notes: string;
  } {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize scores
      const accuracy = Math.max(0, Math.min(100, Number(parsed.accuracy) || 0));
      const completeness = Math.max(0, Math.min(100, Number(parsed.completeness) || 0));
      const notes = String(parsed.notes || 'No notes provided');

      return { accuracy, completeness, notes };
    } catch (error) {
      console.error('[EvaluationPhase] Failed to parse evaluation:', content);
      throw new Error(`Failed to parse evaluation: ${(error as Error).message}`);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
