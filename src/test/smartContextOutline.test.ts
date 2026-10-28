import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import * as path from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmartContext, setWasmDir } from '../modules/smartContext';
import { Message } from '../proxy/types';

// The bundled grammars, as the extension ships them. Tests run from out/test, so media/ is two up.
setWasmDir(path.join(__dirname, '..', '..', 'media', 'wasm'));

// Each fixture is a whole file read, with the lines the outline must list and the ones it must not.
// Line numbers are 1-based and count the fixture exactly as written below.
interface Fixture {
  ext: string;
  source: string;
  declarations: number[];
  notDeclarations: number[];
}

const fixtures: Record<string, Fixture> = {
  typescript: {
    ext: 'ts',
    source: [
      "import { Shape } from './shape';",
      'export interface Container {',
      '  size(): number;',
      '}',
      'export class Box implements Container {',
      '  size(): number {',
      '    return 1;',
      '  }',
      '}',
      'export function make(): Box {',
      '  return new Box();',
      '}',
      'const LIMIT = 3;',
    ].join('\n'),
    declarations: [2, 5, 6, 10],
    notDeclarations: [1, 13],
  },
  python: {
    ext: 'py',
    // Line 7 starts with "class " inside a docstring: a line match would list it, the parser does not
    source: [
      'import os',
      'class Box:',
      '    def size(self):',
      '        return 1',
      'def make():',
      '    """',
      'class Fake:',
      '    """',
      '    return Box()',
      'LIMIT = 3',
    ].join('\n'),
    declarations: [2, 3, 5],
    notDeclarations: [1, 7, 10],
  },
  go: {
    ext: 'go',
    source: [
      'package main',
      'type Box struct {',
      '\tn int',
      '}',
      'func (b Box) Size() int {',
      '\treturn b.n',
      '}',
      'func Make() Box {',
      '\treturn Box{}',
      '}',
    ].join('\n'),
    declarations: [2, 5, 8],
    notDeclarations: [1],
  },
  rust: {
    ext: 'rs',
    source: [
      'use std::fmt;',
      'pub struct Box { n: i32 }',
      'pub enum Kind { Small, Large }',
      'impl Box {',
      '    pub fn size(&self) -> i32 { self.n }',
      '}',
      'pub fn make() -> Box { Box { n: 1 } }',
    ].join('\n'),
    declarations: [2, 3, 4, 5, 7],
    notDeclarations: [1],
  },
  java: {
    ext: 'java',
    source: [
      'import java.util.List;',
      'public class Box {',
      '    public int size() { return 1; }',
      '}',
    ].join('\n'),
    declarations: [2, 3],
    notDeclarations: [1],
  },
  csharp: {
    ext: 'cs',
    source: [
      'namespace Demo {',
      '    public class Box {',
      '        public int Size() { return 1; }',
      '    }',
      '}',
    ].join('\n'),
    declarations: [2, 3],
    notDeclarations: [1, 5],
  },
  ruby: {
    ext: 'rb',
    source: [
      'class Box',
      '  def size',
      '    1',
      '  end',
      'end',
      'def make',
      '  Box.new',
      'end',
    ].join('\n'),
    declarations: [1, 2, 6],
    notDeclarations: [3],
  },
  php: {
    ext: 'php',
    source: [
      '<?php',
      'class Box {',
      '    public function size() { return 1; }',
      '}',
      'function make() { return new Box(); }',
    ].join('\n'),
    declarations: [2, 3, 5],
    notDeclarations: [1],
  },
};

async function outlineOf(file: string, source: string): Promise<string> {
  const messages = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: file } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: source }] },
  ] as unknown as Message[];
  // A size limit of 1 byte makes every fixture a large read, so it is replaced
  const result = await runSmartContext(messages, 1);
  assert.equal(result.replaced, 1, 'the whole-file read is outlined');
  return (result.messages[1].content as unknown as Array<{ content: string }>)[0].content;
}

for (const [language, fixture] of Object.entries(fixtures)) {
  test(`outline (${language}): declarations are listed by line, and other lines are not`, async () => {
    const outline = await outlineOf(`src/sample.${fixture.ext}`, fixture.source);
    for (const line of fixture.declarations) {
      assert.match(outline, new RegExp(`^L${line}: `, 'm'), `line ${line} should be listed`);
    }
    for (const line of fixture.notDeclarations) {
      assert.doesNotMatch(outline, new RegExp(`^L${line}: `, 'm'), `line ${line} should not be listed`);
    }
  });
}
