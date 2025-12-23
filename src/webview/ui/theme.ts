
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
        // Default to dark if not stored, or respect system preference if we wanted to get fancy
        // For now, default dark matches current behavior
        const theme = storedTheme || ThemeManager.DARK_THEME;
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
            btn.innerHTML = theme === ThemeManager.LIGHT_THEME ? moon : sun;
            btn.title = `Switch to ${theme === ThemeManager.LIGHT_THEME ? 'dark' : 'light'} mode`;
        }

        // Dispatch event for components to react (e.g. graph redraw)
        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
    }
}
