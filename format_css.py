from pathlib import Path

css_root = Path('front')


def format_css(text: str) -> str:
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    out = []
    indent = 0
    i = 0
    in_string = False
    string_char = ''
    in_comment = False

    while i < len(text):
        c = text[i]
        if in_comment:
            out.append(c)
            if c == '*' and i + 1 < len(text) and text[i + 1] == '/':
                out.append('/')
                i += 1
                in_comment = False
        elif in_string:
            out.append(c)
            if c == string_char:
                in_string = False
        else:
            if c == '/' and i + 1 < len(text) and text[i + 1] == '*':
                out.append('/*')
                i += 1
                in_comment = True
            elif c in ('"', "'"):
                in_string = True
                string_char = c
                out.append(c)
            elif c == '{':
                while out and out[-1].isspace() and out[-1] != '\n':
                    out.pop()
                out.append(' {')
                out.append('\n')
                indent += 1
                out.append('  ' * indent)
            elif c == ';':
                out.append(';')
                out.append('\n')
                out.append('  ' * indent)
            elif c == '}':
                while out and out[-1].isspace():
                    out.pop()
                out.append('\n')
                indent = max(indent - 1, 0)
                out.append('  ' * indent)
                out.append('}')
                out.append('\n')
                out.append('\n')
                out.append('  ' * indent)
            elif c in ('\n', '\r', '\t'):
                out.append(' ')
            else:
                out.append(c)
        i += 1

    formatted = ''.join(out)
    lines = [line.rstrip() for line in formatted.splitlines()]
    final_lines = []
    blank = False
    for line in lines:
        if not line.strip():
            if not blank:
                final_lines.append('')
                blank = True
        else:
            final_lines.append(line)
            blank = False
    return '\n'.join(final_lines).strip() + '\n'

for path in sorted(css_root.rglob('*.css')):
    text = path.read_text(encoding='utf-8')
    new_text = format_css(text)
    if new_text != text.replace('\r\n', '\n').replace('\r', '\n'):
        path.write_text(new_text, encoding='utf-8')
        print(f'Formatted: {path}')
    else:
        print(f'Skipped: {path}')
