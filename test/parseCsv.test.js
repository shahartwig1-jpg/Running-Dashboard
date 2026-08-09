const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv } = require("../fetch-data");

test("parseCsv: simple unquoted comma-separated rows", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv: a literal quote in the middle of an unquoted field is just a character (ק\"מ case)", () => {
  const rows = parseCsv('שם,יום\nאני,ריצה קלה 8 ק"מ\n');
  assert.deepEqual(rows, [["שם", "יום"], ["אני", 'ריצה קלה 8 ק"מ']]);
});

test("parseCsv: a properly quoted field can contain a comma", () => {
  const rows = parseCsv('a,b\n1,"contains, a comma"\n');
  assert.deepEqual(rows, [["a", "b"], ["1", "contains, a comma"]]);
});

test("parseCsv: doubled quotes inside a quoted field decode to one literal quote", () => {
  const rows = parseCsv('a\n"she said ""hi"" today"\n');
  assert.deepEqual(rows, [["a"], ['she said "hi" today']]);
});

test("parseCsv: trailing row without a final newline is still captured", () => {
  const rows = parseCsv("a,b\n1,2");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});
