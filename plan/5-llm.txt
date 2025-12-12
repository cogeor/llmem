# Part 5: LLM Integration Plan (Recursive Summarization)
# Component: src/llm/

================================================================================
## PURPOSE
================================================================================
Turn the system into an "Architectural Codebase Helper".

Goal:
1. Provide parsed signatures for all files in a tree (Context).
2. Ask Host LLM to synthesize this into Summaries for EACH folder.
3. Store these summaries via `store_summaries`.

================================================================================
## WORKFLOW: get_artifacts(folder, recursive=true)
================================================================================

User: "Start recursive analysis of src/"

1. **Host LLM** calls `get_artifacts(path="src", recursive=true)`

2. **LLMem Server**:
   Detailed Logic:
   - Walk tree: `src/`, `src/mcp`, `src/parser`...
   - Organize signatures by folder.
   
   Returns Response:
   - **Status**: `prompt_ready`
   - **Data**: JSON Map of Folder -> File Signatures
   - **Prompt**: 
     "I have analyzed the following folders. 
      For EACH folder, output a module summary.
      ...
      Return a JSON object where keys are folder paths and values are the summaries."
      
   - **Callback**: `store_summaries`

3. **Host LLM**:
   - Generates JSON map of summaries.
   - Calls `store_summaries(summaries={ "src": "...", "src/mcp": "..." })`.

4. **LLMem Server**:
   - Iterates map.
   - Creates `.summary` file for each entry.

================================================================================
## PROMPTS
================================================================================

### Recursive Summarization Prompt
```
You are an Architectural Codebase Assistant.
Context: I have analyzed the following folders in "{root_path}".
{structured_folder_data}

Task:
For EACH folder listed above, generate a Markdown summary module description.
1. Primary responsibility
2. Files contained and their roles
3. Interactions with other modules

IMPORTANT:
You must trigger the `store_summaries` tool.
Pass a single JSON object where:
- Keys are the folder paths (as shown in context)
- Values are the Markdown content.

Example:
{
  "src/mcp": "# MCP Module...",
  "src/parser": "# Parser Module..."
}
```
