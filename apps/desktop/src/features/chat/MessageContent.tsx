import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function MessageContent({ content, plain = false }: { content: string; plain?: boolean }) {
  if (plain) return <div className="chat-user-content">{content}</div>;
  return <div className="chat-rich-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Generated remote images never fetch silently from a provider's response.
    img: ({ alt }) => <span className="chat-image-reference">{alt || 'Referensi gambar'}</span>,
    a: ({ children, href }) => <a href={href?.startsWith('https://') ? href : undefined} target="_blank" rel="noreferrer noopener">{children}</a>,
    table: ({ children }) => <div className="chat-table-scroll"><table>{children}</table></div>,
  }}>{content}</Markdown></div>;
}
