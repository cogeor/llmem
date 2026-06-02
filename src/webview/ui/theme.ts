
import { sun, moon } from './icons';

export class ThemeManager {
    private static readonly STORAGE_KEY = 'webview-theme';
    private static readonly LIGHT_THEME = 'light';
    private static readonly DARK_THEME = 'dark';

    constructor() {
        this.init();
    }

    private init(): void {
        const storedTheme = localStorage.getItem(ThemeManager.STORAGE_KEY);
        // Default to light when no preference is stored — light reads better
        // for the graph/folder views. A stored choice (either direction) wins.
        const theme = storedTheme || ThemeManager.LIGHT_THEME;
        this.applyTheme(theme);
    }

    public toggle(): void {
        const currentTheme = document.body.classList.contains(ThemeManager.LIGHT_THEME)
            ? ThemeManager.LIGHT_THEME
            : ThemeManager.DARK_THEME;

        const newTheme = currentTheme === ThemeManager.LIGHT_THEME
            ? ThemeManager.DARK_THEME
            : ThemeManager.LIGHT_THEME;

        this.applyTheme(newTheme);
    }

    private applyTheme(theme: string): void {
        // Remove old classes
        document.body.classList.remove(ThemeManager.LIGHT_THEME, ThemeManager.DARK_THEME);

        // Add new class
        document.body.classList.add(theme);

        // Store preference
        localStorage.setItem(ThemeManager.STORAGE_KEY, theme);

        // Update button icon - show sun in dark mode (to switch to light), moon in light mode (to switch to dark)
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            // safe: author-controlled SVG icon string from icons.ts (moon | sun)
            btn.innerHTML = theme === ThemeManager.LIGHT_THEME ? moon : sun;
            btn.title = `Switch to ${theme === ThemeManager.LIGHT_THEME ? 'dark' : 'light'} mode`;
        }

        // Dispatch event for components to react (e.g. graph redraw)
        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
    }
}
