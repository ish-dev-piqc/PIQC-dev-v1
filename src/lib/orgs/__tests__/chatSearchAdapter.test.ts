import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  escapeIlikePattern,
  splitForHighlight,
} from '../chatSearchAdapter';

describe('escapeIlikePattern', () => {
  it('escapes % and _', () => {
    expect(escapeIlikePattern('100%')).toBe('100\\%');
    expect(escapeIlikePattern('cool_thing')).toBe('cool\\_thing');
  });

  it('escapes backslashes', () => {
    expect(escapeIlikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves normal text alone', () => {
    expect(escapeIlikePattern('Hello world')).toBe('Hello world');
  });
});

describe('buildSnippet', () => {
  it('returns the whole body when no query', () => {
    expect(buildSnippet('short body', '')).toBe('short body');
  });

  it('truncates short bodies under maxLength to original', () => {
    expect(buildSnippet('hello world', 'world')).toBe('hello world');
  });

  it('windows around the match with ellipses', () => {
    const body =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'The needle is here, in the middle. ' +
      'More lorem follows after the needle. '.repeat(3);
    const snippet = buildSnippet(body, 'needle', { pad: 20 });
    expect(snippet).toContain('needle');
    expect(snippet).toContain('…');
  });

  it('falls back to head-of-body when query not found', () => {
    expect(buildSnippet('hello world', 'absent', { maxLength: 5 })).toBe(
      'hello…',
    );
  });

  it('case-insensitive match locates the window', () => {
    const body = 'PATIENT P-0023 status check';
    const snippet = buildSnippet(body, 'p-0023');
    expect(snippet).toContain('P-0023');
  });
});

describe('splitForHighlight', () => {
  it('returns single segment when query empty', () => {
    expect(splitForHighlight('hello', '')).toEqual(['hello']);
  });

  it('returns single segment when no match', () => {
    expect(splitForHighlight('hello', 'world')).toEqual(['hello']);
  });

  it('returns [before, match, after] for one match', () => {
    expect(splitForHighlight('hello world', 'world')).toEqual([
      'hello ',
      'world',
      '',
    ]);
  });

  it('preserves original case of the matched substring', () => {
    expect(splitForHighlight('Hello World', 'world')).toEqual([
      'Hello ',
      'World',
      '',
    ]);
  });

  it('handles repeated matches', () => {
    expect(splitForHighlight('aXbXcX', 'x')).toEqual([
      'a',
      'X',
      'b',
      'X',
      'c',
      'X',
      '',
    ]);
  });
});
