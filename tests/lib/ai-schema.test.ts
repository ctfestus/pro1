import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { lessonBlockSchema } from '@/lib/lesson-blocks-ai';
import { mapSchema, toAnthropicSchema, toGeminiSchema, validateAiResult } from '@/lib/ai/schema';
import type { JsonSchema } from '@/lib/ai/types';

// Evaluate only schema expressions, including schemas declared inside route branches.
// No route runs and no service is contacted. Frozen hashes were verified against the
// pre-migration Gemini contracts, with review criterion IDs added for deterministic gates;
// tests must not depend on a moving Git branch.
function schemas(source: string, file: string): JsonSchema[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations: ts.VariableDeclaration[] = [];
  const candidates: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isObjectLiteralExpression(node) && node.properties.some(prop =>
      ts.isPropertyAssignment(prop) && prop.name.getText(ast) === 'type' &&
      (ts.isStringLiteral(prop.initializer) && ['object', 'array', 'string', 'number', 'boolean', 'integer'].includes(prop.initializer.text) ||
       ts.isPropertyAccessExpression(prop.initializer) && prop.initializer.expression.getText(ast) === 'Type'))) candidates.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const scopeContains = (declaration: ts.Node, reference: ts.Node) => {
    const scope = declaration.parent.parent.parent;
    return scope.pos <= reference.pos && scope.end >= reference.end;
  };
  function evaluate(node: ts.Expression): any {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return evaluate(node.expression);
    if (ts.isTemplateExpression(node)) return node.getText(ast);
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(child =>
      ts.isSpreadElement(child) ? evaluate(child.expression) : [evaluate(child as ts.Expression)]);
    if (ts.isObjectLiteralExpression(node)) {
      const out: JsonSchema = {};
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) Object.assign(out, evaluate(prop.expression));
        else if (ts.isPropertyAssignment(prop)) out[prop.name.getText(ast).replace(/^['"]|['"]$/g, '')] = evaluate(prop.initializer);
        else if (ts.isShorthandPropertyAssignment(prop)) out[prop.name.text] = evaluate(prop.name);
      }
      return out;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.getText(ast) === 'Type') return node.name.text;
      return evaluate(node.expression)[node.name.text];
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarations.filter(d => d.name.getText(ast) === node.text && d.pos < node.pos && scopeContains(d, node)).at(-1);
      if (declaration?.initializer) return evaluate(declaration.initializer);
      // Function parameter values only occur in descriptions and discriminant enums.
      if (node.text === 'type') return 'example';
      if (node.text === 'required' || node.text === 'partRequired') return [];
      if (node.text === 'properties' || node.text === 'partProperties') return {};
      if (node.text === 'description') return 'Example description';
      throw new Error(`Unresolved schema identifier ${node.text} in ${file}`);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.getText(ast) === 'lessonBlockSchema') return lessonBlockSchema();
      if (node.expression.getText(ast) === 'String') return String(evaluate(node.arguments[0]));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evaluate(node.left) + evaluate(node.right);
    throw new Error(`Unsupported schema expression ${node.getText(ast)} in ${file}`);
  }
  return candidates.map(evaluate);
}

const schemaFiles = [
  'app/api/ai-course/route.ts', 'app/api/ai-guided-project/route.ts',
  'app/api/announcement-subtitle/route.ts', 'app/api/application-forms/suggest-options/route.ts',
  'app/api/code-review/route.ts', 'app/api/dashboard-critique/route.ts',
  'app/api/data-center/generate-metadata/route.ts', 'app/api/document-review/route.ts',
  'app/api/excel-review/route.ts', 'app/api/extract-rubric/route.ts', 'app/api/generate/route.ts',
  'app/api/ve-answer-review/route.ts', 'app/api/ve-brief-chat/route.ts',
  'app/api/ve-instructor-review/draft/route.ts', 'app/api/written-review/route.ts',
  'lib/ai-assist-server.ts', 'lib/lesson-blocks-ai.ts',
];

const geminiBaselines = [
  '168d1fdc7bb0ddb068f7387bfa13c7981b5f4a72856356d5d6842a12acedfa76',
  'cc439b9b28641c9c66eded1598941ffe49656b5a8c84f24a43b8b04e5b3b795e',
  'c7b8aa9a5222fdfd461a1ff1aa9820ba8aeca7d84200eb55e63de53a12b0b87e',
  '6db1454f29de4a684ad6223f2c96e95c95b48b140a23c270c2f97852f82de907',
  'cdb10333c7f2359387bef07bd6121969cc178b5ec9c52fa9de194dd26ee1c4e0',
  '438edf66228bbeec89745ead06a8000766fd4894c84732086b60c038c6f621bf',
  '461e92f28e2b301f434e74bf190806efa0cd13412c9ff54f440f7ec3431be394',
  'e49f756b3e605cad4aa86259fb0d02dd35486052ab55d61c4ec32314bd8d7379',
  'fc468142930117fd4b49458a543e04fb92fa99bbf1b967c34f1b57e5c1d3c68a',
  'd92848e20e57340c0201aea54c02f52f2704da4329a28f860d38510d3a6956f0',
  '86e7a389712bc00addca5ed6fa7e645974575ff3dac7ccfaedf1c050ac9047ac',
  '0d8608126658fa8a3511b3a8573979dd0a2d0bd34abab6206a11b7be03fd81ed',
  '42902bb940defee23f8f240ca17bafbfc31f5347172a418564abc0820925017e',
  'cab4d6fec5114658ce2a796df59c59555f098b547e8a5b85ab2b1f94c2348ef2',
  '40bdb15629bc45a305adc96f134785a1b4e62ef65054fa98ca173bfedd270e86',
  '05efd824961425824c6378edfb0645708582c81070f28ab366e5287310a9459b',
  '4881189f8b0f6b5274e7d8120e06438856464a870a6ae1cb683a7f9d8e5f334e',
];

describe('all migrated response schemas', () => {
  for (const [index, file] of schemaFiles.entries()) {
    it(`${file}: preserves Gemini requests and produces valid neutral/Claude schemas`, () => {
      const current = schemas(readFileSync(file, 'utf8'), file);
      expect(current.length).toBeGreaterThan(0);
      expect(createHash('sha256').update(JSON.stringify(current.map(toGeminiSchema))).digest('hex')).toBe(geminiBaselines[index]);
      for (const schema of current) {
        // Compile the original schema to check keyword types and references. A false validation
        // result for null is fine; schema compilation errors are not.
        try { validateAiResult(schema, null); } catch (error) {
          expect((error as Error).message).toBe('AI response does not match the response schema');
        }
        mapSchema(toAnthropicSchema(schema), node => {
          if (node.type === 'object') expect(node.additionalProperties).toBe(false);
          expect(node).not.toHaveProperty('minItems');
          expect(node).not.toHaveProperty('maxItems');
          return node;
        });
      }
    });
  }

  it('enforces the VE draft array bounds after the provider omits them', () => {
    const file = 'app/api/ve-instructor-review/draft/route.ts';
    const schema = schemas(readFileSync(file, 'utf8'), file)[0];
    const category = { name: 'Quality', score: 80, summary: 'Evidence', strengths: [], gaps: [] };
    const valid = { score: 80, summary: 'Report', findings: [], categories: [category, category, category], recommendations: ['a', 'b', 'c'] };
    expect(() => validateAiResult(schema, valid)).not.toThrow();
    for (const categories of [[category], Array(6).fill(category)]) {
      expect(() => validateAiResult(schema, { ...valid, categories })).toThrow('response schema');
    }
    expect(() => validateAiResult(schema, { ...valid, recommendations: ['a', 'b'] })).toThrow('response schema');
    expect(() => validateAiResult(schema, { ...valid, score: '80' })).toThrow('response schema');
    expect(schema.properties.categories.minItems).toBe(3);
    expect(toAnthropicSchema(schema).properties.categories.description).toContain('minItems: 3');
  });

  it('does not mutate shared schema objects or confuse a property called type with a keyword', () => {
    const schema = lessonBlockSchema();
    const snapshot = JSON.stringify(schema);
    const converted = toGeminiSchema(schema);
    expect(converted.anyOf[0].properties.type.type).toBe('STRING');
    toAnthropicSchema(schema);
    expect(JSON.stringify(schema)).toBe(snapshot);
  });
});

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('AI vendor boundary', () => {
  it('allows vendor SDK imports only in adapter files', () => {
    for (const file of [...files('app'), ...files('lib')]) {
      if (file.startsWith('lib/ai/adapters/')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?:from\s*|import\s*\()['"](?:@google\/genai|openai|@anthropic-ai\/sdk)['"]/);
    }
  });
});
