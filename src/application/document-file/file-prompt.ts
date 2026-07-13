/**
 * File enrichment-prompt + design-document renderers (Loop 12 extraction of
 * `application/document-file.ts`).
 *
 * `renderEnrichmentPrompt` builds the LLM task prompt from the structural
 * markdown + source code; `renderDesignDocument` formats the LLM's enrichment
 * payload into the `.llmem/docs/{path}.md` design document. Both are pure string
 * builders.
 */

import { getLanguageFromPath } from '../../parser/config';
import type { EnrichedFunction } from './types';

export function renderEnrichmentPrompt(
    filePath: string,
    fileInfoMarkdown: string,
    sourceCode: string,
): string {
    const lineCount = sourceCode.split('\n').length;
    const language = getLanguageFromPath(filePath);

    return `# DESIGN DOCUMENT GENERATION TASK

## LLM CONFIGURATION
- **max_tokens:** 16000
- **reasoning:** enabled - Use chain-of-thought reasoning. Think step by step before writing each section.
- **temperature:** 0.3 (be precise and accurate)

> **IMPORTANT:** This is a complex documentation task. Take your time to:
> 1. First, read and understand the entire source code
> 2. Identify all key relationships and dependencies
> 3. Then systematically document each component
> Do not rush. Quality and completeness are more important than speed.

---

You are a senior software architect creating a **Design Document** for a source file.
The document must be detailed enough that another developer could **reimplement the entire file** from it.

## FILE BEING DOCUMENTED
- **Path:** \`${filePath}\`
- **Language:** ${language}
- **Lines:** ${lineCount}

---

## STRUCTURAL ANALYSIS (auto-extracted)

${fileInfoMarkdown}

---

## SOURCE CODE

\`\`\`${language}
${sourceCode}
\`\`\`

---

## YOUR TASK: Generate a Complete Design Document

Create documentation with the following sections. Be **extremely detailed** - assume the reader cannot see the source code.

### 1. FILE OVERVIEW
- **Purpose:** What problem does this file solve? What is its role in the system?
- **Dependencies:** What does it import and why? (both internal and external)
- **Consumers:** Who uses this file? What API does it expose?
- **Key Concepts:** What domain concepts or patterns does it implement?

### 2. DATA STRUCTURES
For each interface, type, class, or constant:
- **Name and Purpose:** What data does it represent?
- **Fields:** Each field with its type and meaning
- **Invariants:** Any constraints or relationships between fields
- **Usage Pattern:** How is this data typically created/used?

### 3. FUNCTION SPECIFICATIONS
For EACH function/method (this is critical):

#### \`functionName(params): returnType\`
- **Purpose:** One sentence describing what it does
- **Parameters:**
  - Each parameter with type, meaning, and valid values
- **Return Value:** What is returned and when
- **Side Effects:** Any mutations, I/O, or state changes
- **Algorithm (DETAILED):**
  - Step-by-step breakdown of the implementation
  - Include edge cases handled
  - Include any branching logic
  - Detail enough to reimplement without seeing code
- **Dependencies:** What other functions/modules does it call?
- **Error Handling:** What errors can occur and how are they handled?

### 4. CONTROL FLOW
- How do the functions interact?
- What is the typical call sequence?
- Draw the data flow through the module

### 5. REIMPLEMENTATION NOTES
- Tricky implementation details that might be missed
- Performance considerations
- Edge cases that must be handled
- Assumptions made by the code

---

## OUTPUT FORMAT

After your analysis, call the \`report_file_info\` tool with:

\`\`\`json
{
  "path": "${filePath}",
  "overview": "<detailed overview section as markdown>",
  "inputs": "<what the file takes as input: imports, parameters, dependencies>",
  "outputs": "<what the file produces: exports, side effects, return values>",
  "functions": [
    {
      "name": "<function name>",
      "purpose": "<one sentence purpose>",
      "implementation": "<detailed algorithm in bullet points, 5-10 points minimum>"
    }
  ]
}
\`\`\`

**IMPORTANT:** The implementation field must contain enough detail to reimplement the function without seeing the original code. Include specific logic, conditions, data transformations, and edge cases.`;
}

export interface DesignDocumentInput {
    filePath: string;
    overview: string;
    inputs?: string;
    outputs?: string;
    functions: EnrichedFunction[];
}

export function renderDesignDocument(input: DesignDocumentInput): string {
    const { filePath, overview, inputs, outputs, functions } = input;
    const lines: string[] = [];

    lines.push(`# DESIGN DOCUMENT: ${filePath}`);
    lines.push('');
    lines.push(
        '> **Instructions:** This document serves as a blueprint for implementing the source code. ' +
        'Review the specifications below before writing code.',
    );
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## FILE OVERVIEW');
    lines.push('');
    lines.push(overview);
    lines.push('');

    if (inputs) {
        lines.push(`**Inputs:** ${inputs}`);
        lines.push('');
    }
    if (outputs) {
        lines.push(`**Outputs:** ${outputs}`);
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## FUNCTION SPECIFICATIONS');
    lines.push('');

    for (const func of functions) {
        lines.push(`### \`${func.name}\``);
        lines.push('');
        lines.push(`**Purpose:** ${func.purpose}`);
        lines.push('');
        lines.push('**Implementation:**');
        lines.push('');
        lines.push(func.implementation);
        lines.push('');
    }

    return lines.join('\n');
}
