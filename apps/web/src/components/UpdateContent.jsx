import { useState } from 'react';
import { Link } from 'react-router-dom';
import { validUpdateBlock, validUpdateImage } from 'shared/update';
import ImageBlock from './blocks/ImageBlock.jsx';
import RichTextBlock from './blocks/RichTextBlock.jsx';
import { primaryActionClass } from './controlClasses.js';

export function UpdateImage({ image }) {
  return validUpdateImage(image) ? <ImageBlock block={image} /> : null;
}

function PracticePoll({ block }) {
  const [selected, setSelected] = useState('');
  const [answer, setAnswer] = useState('');
  return (
    <form className="border-y border-rule-hairline py-lg" onSubmit={(event) => {
      event.preventDefault();
      setAnswer(selected);
    }}>
      <fieldset>
        <legend className="font-heading text-h3 font-semibold">{block.question}</legend>
        <p className="mt-xs text-caption text-text-secondary">Demo poll. Your choice stays on this page. No votes are sent or counted.</p>
        <div className="my-sm space-y-xs">
          {block.options.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-xs text-body">
              <input type="radio" name="practice-poll" value={option} checked={selected === option}
                onChange={() => { setSelected(option); setAnswer(''); }} />
              {option}
            </label>
          ))}
        </div>
        <button type="submit" className={primaryActionClass} disabled={!selected}>Try the poll</button>
        <p role="status" className="mt-xs text-body text-text-secondary">{answer ? `You chose: ${answer}. This is a preview, not a submitted vote.` : ''}</p>
      </fieldset>
    </form>
  );
}

function UpdateBlock({ block }) {
  if (!validUpdateBlock(block)) return null;
  switch (block.type) {
    case 'richtext': return <RichTextBlock block={block} />;
    case 'image': return <UpdateImage image={block.image} />;
    case 'practicePoll': return <PracticePoll block={block} />;
    case 'columns': return (
      <div className="grid gap-lg md:grid-cols-2">
        {block.columns.map((column) => <section key={column.heading} className="min-w-0">
          <h2 className="mb-sm font-heading text-h3 font-semibold">{column.heading}</h2>
          <RichTextBlock block={{ value: column.body }} />
        </section>)}
      </div>
    );
    case 'button': return block.href.startsWith('/')
      ? <Link className={primaryActionClass} to={block.href}>{block.label}</Link>
      : <a className={primaryActionClass} href={block.href} rel="noopener noreferrer">{block.label}</a>;
    default: return null;
  }
}

export default function UpdateContent({ content }) {
  if (!Array.isArray(content)) return null;
  return <div className="mt-lg space-y-lg">{content.slice(0, 20).map((block, index) => (
    <div key={index}><UpdateBlock block={block} /></div>
  ))}</div>;
}
