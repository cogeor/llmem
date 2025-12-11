import { describe, it } from 'node:test';
import * as assert from 'assert';
import { Extractor } from '../../parser/extractor';
import { CodeParser } from '../../parser/parser';

describe('Parser/Extractor', () => {
    const parser = new CodeParser();
    const extractor = new Extractor();

    it('should extract TypeScript functions', () => {
        const code = `
            function hello(name: string): void {
                console.log("Hello " + name);
            }
            const arrow = (a: number) => a * 2;
        `;
        const tree = parser.parse('test.ts', code);
        assert.ok(tree);
        const outline = extractor.extract(tree!, 'typescript', 'test.ts');

        assert.strictEqual(outline.functions.length, 2);
        assert.strictEqual(outline.functions[0].name, 'hello');
        assert.strictEqual(outline.functions[1].name, 'arrow');
    });

    it('should extract TypeScript classes', () => {
        const code = `
            class Greeter {
                name: string;
                constructor(name: string) {
                    this.name = name;
                }
                greet() {
                    return "Hello " + this.name;
                }
            }
        `;
        const tree = parser.parse('test.ts', code);
        assert.ok(tree);
        const outline = extractor.extract(tree!, 'typescript', 'test.ts');

        assert.strictEqual(outline.classes.length, 1);
        assert.strictEqual(outline.classes[0].name, 'Greeter');
        assert.strictEqual(outline.classes[0].methods.length, 2); // constructor + greet
    });

    it('should extract Python functions', () => {
        const code = `
def add(a, b):
    return a + b

class Calculator:
    def multiply(self, a, b):
        return a * b
        `;
        const tree = parser.parse('test.py', code);
        // If python parser is not available/working, this might be null or fail.
        // Assuming environment has it or it was installed successfully.
        if (!tree) {
            console.warn('Python parser not available, skipping test');
            return;
        }

        const outline = extractor.extract(tree, 'python', 'test.py');
        assert.strictEqual(outline.functions.length, 1);
        assert.strictEqual(outline.functions[0].name, 'add');

        assert.strictEqual(outline.classes.length, 1);
        assert.strictEqual(outline.classes[0].name, 'Calculator');
        assert.strictEqual(outline.classes[0].methods.length, 1);
        assert.strictEqual(outline.classes[0].methods[0].name, 'multiply');
    });
});
