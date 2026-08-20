const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Regression: bar heights saturated near the top of the scale. A bar's height is
// set as a percentage, and it used to hang directly off .bob-bar-col — which
// also holds the label and value rows. The percentage therefore resolved against
// the whole column, so a tall bar overflowed and flexbox shrank it back into
// whatever space the text left. Measured with the old CSS, values 96/128/96
// rendered 120px/123px/120px: a 33% larger value grew the bar by 2.5%.
//
// The fix gives the bar its own .bob-bar-track (the leftover vertical space) and
// takes the bar out of flow inside it, so nothing can shrink it. Same values now
// render 96px/128px/96px. Browser layout can't be asserted here, so this guards
// the structure that makes the geometry correct.
const root = path.join(__dirname, '..');
const appView = fs.readFileSync(path.join(root, 'src', 'views', 'app-view.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

// The bar must be built inside a track, not directly in the column.
assert.ok(/createDiv\(\{ cls: 'bob-bar-track' \}\)/.test(appView),
  'bar chart no longer creates a .bob-bar-track');
assert.ok(/const bar = track\.createDiv\(\{ cls: 'bob-bar' \}\)/.test(appView),
  '.bob-bar must be a child of .bob-bar-track, or its % height resolves against the whole column');
assert.ok(!/const bar = col\.createDiv\(\{ cls: 'bob-bar' \}\)/.test(appView),
  '.bob-bar was reparented onto the column — the saturation bug is back');

const ruleFor = (selector) => {
  const match = styles.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
};

// The track must be able to shrink below content size and act as the
// positioning context the bar's percentage height resolves against.
const track = ruleFor('.bob-bar-track');
assert.ok(/position:\s*relative/.test(track), '.bob-bar-track must be the positioning context');
assert.ok(/min-height:\s*0/.test(track), '.bob-bar-track needs min-height:0 or flex refuses to shrink it');
assert.ok(/flex:\s*1/.test(track), '.bob-bar-track must claim the leftover column space');

// Out of flow, so flex-shrink can never compress a tall bar again.
const bar = ruleFor('.bob-bar');
assert.ok(/position:\s*absolute/.test(bar), '.bob-bar must be out of flow inside its track');
assert.ok(/bottom:\s*0/.test(bar), '.bob-bar must be anchored to the bottom of its track');

// The value row was unstyled and inherited the body font size, eating plot height.
assert.ok(/\.bob-bar-value\s*\{/.test(styles), '.bob-bar-value must have an explicit size');

console.log('bar-chart-geometry.test.js: ok');
