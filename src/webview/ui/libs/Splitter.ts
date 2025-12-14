
export class Splitter {
    private element: HTMLElement;
    private prevPane: HTMLElement;
    private nextPane: HTMLElement;
    private isDragging: boolean = false;
    private startX: number = 0;
    private startWidth: number = 0;
    private direction: 'left' | 'right' = 'left'; // which pane to resize

    constructor(element: HTMLElement, targetPane: HTMLElement, direction: 'left' | 'right' = 'left') {
        this.element = element;
        // In this specific layout:
        // splitter-1 resizes explorer-pane (its previous sibling) -> 'left'
        // splitter-2 resizes design-pane (its previous sibling) -> 'left'

        // Actually, for flex layout:
        // dragging splitter-1 changes width of explorer-pane.
        // dragging splitter-2 changes flex-grow/basis of design-pane vs graph-pane? 
        // Or better: give design-pane a pixel width when resizing vs graph pane?

        // Simplest approach: Target specific pane to set explicit width on.
        this.prevPane = element.previousElementSibling as HTMLElement;
        this.nextPane = element.nextElementSibling as HTMLElement;

        this.element.addEventListener('mousedown', this.onMouseDown.bind(this));
    }

    private onMouseDown(e: MouseEvent) {
        this.isDragging = true;
        this.startX = e.clientX;
        this.element.classList.add('active');

        // We resize the previous pane by default
        this.startWidth = this.prevPane.getBoundingClientRect().width;

        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);

        // Prevent text selection
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    }

    private onMouseMove = (e: MouseEvent) => {
        if (!this.isDragging) return;

        const dx = e.clientX - this.startX;
        const newWidth = this.startWidth + dx;

        // Min width constraint
        if (newWidth < 150) return;

        // Set explicit width on the previous pane
        // This works for explorer (fixed width)
        // For two flex:1 panes (Design/Graph), setting width on the left one 
        // makes it fixed, and the other fills remaining space. This feels natural.
        this.prevPane.style.width = `${newWidth}px`;
        this.prevPane.style.flex = 'none';
    }

    private onMouseUp = () => {
        this.isDragging = false;
        this.element.classList.remove('active');
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }
}
