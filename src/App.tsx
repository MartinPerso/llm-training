import katex from 'katex';
import 'katex/dist/katex.min.css';

// Constant, trusted input: safe to inject as HTML.
const FORMULA_HTML = katex.renderToString(
  'A^{(i)}=\\frac{r^{(i)}-\\text{mean}(\\mathbf r)}{\\text{std}(\\mathbf r)}',
  { throwOnError: false },
);

export default function App() {
  return (
    <main className="app">
      <h1>LLM Book Quiz</h1>
      <p>Coming soon</p>
      <div className="formula" dangerouslySetInnerHTML={{ __html: FORMULA_HTML }} />
      <footer>
        Questions based on{' '}
        <a
          href="https://alisawuffles.notion.site/alisa-s-book-of-llms"
          target="_blank"
          rel="noopener noreferrer"
        >
          Alisa's book of LLMs
        </a>
        .
      </footer>
    </main>
  );
}
