import zalgo from 'to-zalgo';

function dedent(strings: TemplateStringsArray, ...values: any[]): string {
  // TODO: fix dedent fn
  // const fullString = strings[0] + values.map((v, i) => `${v}${strings[i + 1]}`).join('');
  // const lines = fullString.split('\n');

  // const firstNonEmpty = lines.findIndex(line => line.trim() !== '');
  // const lastNonEmpty = lines.findLastIndex
  //   ? lines.findLastIndex(line => line.trim() !== '')
  //   : lines.length - 1 - lines.slice().reverse().findIndex(line => line.trim() !== '');

  // if (firstNonEmpty === -1 || lastNonEmpty === -1) return '';

  // const trimmedLines = lines.slice(firstNonEmpty, lastNonEmpty + 1);

  // const minIndent = trimmedLines
  //   .filter(line => line.trim())
  //   .reduce((min, line) => {
  //     const indentSize = line.match(/^(\s*)/)?.[0].length ?? 0;
  //     return Math.min(min, indentSize);
  //   }, Infinity);

  // return trimmedLines.map(line => line.slice(minIndent)).join('\n');

  // Temporary fix — remove all leading whitespace on each line
  const fullString = strings[0] + values.map((v, i) => `${v}${strings[i + 1]}`).join('');
  return fullString.split('\n').map(line => line.trimStart()).join('\n').trim();
}

export { dedent as d, zalgo };