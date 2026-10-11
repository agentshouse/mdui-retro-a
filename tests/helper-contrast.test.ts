import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {render} from '@testing-library/react';
import {NoteForm} from '../src/App';
import {BoardView, type BoardActions} from '../src/BoardView';
import {COLORS, type Board, type Column, type Note} from '../src/model';
import {compile, compileString} from 'sass';
import {parse} from 'postcss';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const options = {loadPaths: [path.join(root, 'src')]};
const css = parse(compile(path.join(root, 'src/port.scss'), options).css);
const helperSelectors = [
  '.retro-status', '.retro-column-description', '.retro-empty-column',
  '.retro-note-kind', '.retro-drag-handle', '.retro-library-intro>p:last-child',
  '.retro-library-actions>span', '.retro-board-card p', '.retro-board-card>span',
  '.retro-library-footer', '.retro-help', '.retro-attribution',
  '.board-header__access-policy-status', '.column-details__notes-count',
  '.note__marker-edited', '.retro-note-more', '.retro-votes',
];
function declaration(selector: string, property: string) {
  let result = '';
  css.walkRules(rule => {
    if (rule.selector.split(',').some(value => value.replaceAll(' ', '') === selector.replaceAll(' ', ''))) {
      rule.walkDecls(property, decl => { result = decl.value; });
    }
  });
  return result;
}
const swatches = parse(compileString(`
  @use 'sass:map';
  @use 'constants/colors';
  .surfaces {
    --white: #{colors.$gray--000};
    --vote-tint: #{colors.$blue--500};
    --dark-header-hover: #{colors.$pink--500};
    --light-odd: #{colors.$gray--100};
    --light-even: #{colors.$gray--200};
    --dark-page: #{colors.$navy--600};
    --dark-odd: #{colors.$navy--500};
    --dark-note: #{colors.$navy--400};
    @each $name, $shades in map.merge(colors.$primary-colors, colors.$secondary-colors) {
      --light-accent-#{$name}: #{map.get($shades, 500)};
      --dark-accent-#{$name}: #{map.get($shades, 400)};
    }
  }
`, options).css);
const palette: Record<string, string> = {};
swatches.walkDecls(decl => { palette[decl.prop] = decl.value; });
const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
function luminance(channels: number[]) {
  const linear = channels.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(foreground: string, background: number[]) {
  const a = luminance(rgb(foreground)), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
const overlay = (foreground: string, background: string, opacity: number) => rgb(foreground).map((channel, index) => channel * opacity + rgb(background)[index] * (1 - opacity));

describe('port helper foregrounds retain readable donor-family theme pairs', () => {
  it.each(helperSelectors)('%s uses the shared theme-paired foreground', selector => {
    expect(declaration(selector, 'color')).toBe('var(--retro-helper-text)');
  });
  it('uses existing donor foreground shades without changing the palette', () => {
    expect(declaration('.retro-app', '--retro-helper-text')).toBe('#454e63');
    expect(declaration('[data-theme=dark] .retro-app', '--retro-helper-text')).toBe('#b5b8c1');
  });
  it.each(['light', 'dark'])('%s helpers meet 4.5:1 on their donor surfaces, including column stripes', theme => {
    const foreground = declaration(theme === 'dark' ? '[data-theme=dark] .retro-app' : '.retro-app', '--retro-helper-text');
    const names = theme === 'light' ? ['--white', '--light-odd', '--light-even'] : ['--dark-page', '--dark-odd', '--dark-note'];
    for (const name of names) expect(contrast(foreground, rgb(palette[name])), `${theme} on ${name}`).toBeGreaterThanOrEqual(4.5);
    const voteSurface = theme === 'light' ? palette['--white'] : palette['--dark-note'];
    expect(contrast(foreground, overlay(palette['--vote-tint'], voteSurface, .07)), `${theme} vote button tint`).toBeGreaterThanOrEqual(4.5);
    const headerSurface = theme === 'light' ? palette['--white'] : palette['--dark-page'];
    expect(contrast(foreground, overlay(theme === 'light' ? palette['--vote-tint'] : palette['--dark-header-hover'], headerSurface, theme === 'light' ? .06 : .15)), `${theme} header hover`).toBeGreaterThanOrEqual(4.5);
    const columnNames = theme === 'light' ? ['--light-odd', '--light-even'] : ['--dark-page', '--dark-odd'];
    const accents = Object.entries(palette).filter(([name]) => name.startsWith(`--${theme}-accent-`));
    expect(accents.length).toBeGreaterThanOrEqual(7);
    for (const name of columnNames) for (const [accentName, accent] of accents) {
      expect(contrast(foreground, overlay(accent, palette[name], theme === 'light' ? .2 : .04)), `${theme} ${accentName} stripe on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// A selector-only SCSS test cannot detect omitted donor selectors or the real
// inherited cascade. Render the actual BoardView with its imported donor styles.
const donorImports = [...readFileSync(path.join(root, 'src/BoardView.tsx'), 'utf8').matchAll(/import '([^']+\.scss)'/g)].map(match => path.resolve(root, 'src', match[1]));
const donorCSS = donorImports.map(file => compile(file, options).css).join('\n');
const rootCSS = compileString(readFileSync(path.join(root, 'src/index.scss'), 'utf8').replace(/^@import .*;$/gm, ''), options).css;
let style: HTMLStyleElement | undefined;
afterEach(() => { style?.remove(); style = undefined; delete document.documentElement.dataset.theme; });
it.each(['light', 'dark'])('renders the actual %s board header, counts, metadata and enabled actions with readable helper colors', theme => {
  document.documentElement.dataset.theme = theme;
  style = document.createElement('style');
  style.textContent = donorCSS + rootCSS + css.toString();
  document.head.append(style);
  const board: Board = {id:'b', room:'r', path:'b.md', name:'Contrast regression', description:'', isLocked:false};
  const columns: Column[] = COLORS.map((color, index) => ({id:`c${index}`, room:'r', path:`c${index}.md`, board_id:'b', name:color, description:'Column helper', color, index, visible:true}));
  const notes: Note[] = columns.map((column, index) => ({id:`n${index}`, room:'r', path:`n${index}.md`, board_id:'b', column_id:column.id, text:'Readable note', rank:0, edited:true, votes:1, stack_id:'', lastEditedBy:null}));
  const actions: BoardActions = {dropNote:vi.fn(), addVote:vi.fn(), addNote:vi.fn(async()=>true), editNote:vi.fn(), editColumn:vi.fn(), moveNote:vi.fn(), library:vi.fn(), settings:vi.fn(), addColumn:vi.fn(), export:vi.fn(), toggleLock:vi.fn(), toggleTheme:vi.fn()};
  const view = render(createElement('div', {className:'retro-app'}, createElement(BoardView, {board, columns, notes, votes:[], busy:false, actions})));
  const expected = theme === 'light' ? '#454e63' : '#b5b8c1';
  for (const selector of ['.board-header__access-policy-status span', '.column-details__notes-count', '.retro-column-description', '.retro-attribution', '.note__marker-edited', '.retro-note-kind', '.retro-note-more', '.retro-votes']) {
    const elements = [...view.container.querySelectorAll<HTMLElement>(selector)];
    expect(elements.length, selector).toBeGreaterThan(0);
    for (const element of elements) {
      expect(getComputedStyle(element).color, `${theme} ${selector}`).toBe(expected);
      if (element instanceof HTMLButtonElement) expect(element).toBeEnabled();
    }
  }
});

it.each(['light', 'dark'])('%s port dialog action and eyebrow foregrounds preserve readable donor-family colors', theme => {
  document.documentElement.dataset.theme = theme;
  style = document.createElement('style');
  style.textContent = donorCSS + rootCSS + css.toString();
  document.head.append(style);
  const column: Column = {id:'c', room:'r', path:'c.md', board_id:'b', name:'Positive', description:'', color:'backlog-blue', index:0, visible:true};
  const note: Note = {id:'n', room:'r', path:'n.md', board_id:'b', column_id:'c', text:'Readable note', rank:0, edited:true, votes:1, stack_id:'', lastEditedBy:null};
  const view = render(createElement('div', {className:'retro-app'},
    createElement('p', {className:'retro-eyebrow'}, 'Make space for your next idea'),
    createElement(NoteForm, {note, notes:[note], columns:[column], busy:false, close:vi.fn(), save:vi.fn(), remove:vi.fn(), move:vi.fn(), group:vi.fn(), unstack:vi.fn(), open:vi.fn(), addVote:vi.fn()})
  ));
  const expectedPink = theme === 'light' ? '#cc0054' : '#ff99c3';
  for (const selector of ['.retro-eyebrow', '.retro-form-actions .danger']) {
    const element = view.container.querySelector<HTMLElement>(selector)!;
    expect(getComputedStyle(element).color).toBe(expectedPink);
    if (element instanceof HTMLButtonElement) expect(element).toBeEnabled();
    const background = selector === '.retro-eyebrow' ? (theme === 'light' ? '--white' : '--dark-page') : (theme === 'light' ? '--white' : '--dark-odd');
    expect(contrast(expectedPink, rgb(palette[background]))).toBeGreaterThanOrEqual(4.5);
  }
  const primary = view.container.querySelector<HTMLButtonElement>('.retro-form-actions .primary')!;
  expect(primary).toBeEnabled();
  expect(getComputedStyle(primary).color).toBe('#111111');
  expect(getComputedStyle(primary).backgroundColor).toBe('#ff0069');
  expect(contrast('#111111', rgb('#ff0069'))).toBeGreaterThanOrEqual(4.5);
  expect(declaration('.retro-no-columns button', 'color')).toBe('#111111');
});
