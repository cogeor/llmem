# Language Server Requirements

To enable visualization for languages other than TypeScript/JavaScript, you must have the corresponding Language Server executable installed and available in your system `PATH`.

LLMem connects to these servers via standard IO (stdio) to extract symbol and reference information.

## Supported Languages

### Python
*   **Required Command**: `pylsp`
*   **Installation**:
    ```bash
    pip install python-lsp-server
    ```
    *Note: `pyright-langserver` support is planned but currently defaults to `pylsp`.*

### C / C++
*   **Required Command**: `clangd`
*   **Installation**:
    *   **macOS**: `brew install typescript-language-server` (No, wait, for C++ it's llvm) -> `brew install llvm`
    *   **Windows**: Install [LLVM](https://llvm.org/builds/) or use `winget install LLVM.LLVM`.
    *   **Linux**: `sudo apt install clangd`

### R
*   **Required Command**: `R`
*   **Installation**:
    1.  Ensure R is installed.
    2.  Install the language server package in R:
        ```R
        install.packages("languageserver")
        ```

## Troubleshooting
If a supported language file is not appearing in the graph:
1.  Verify the command (`pylsp`, `clangd`, or `R`) runs from your terminal.
2.  Restart the extension (Reload Window) after installing the tool.
