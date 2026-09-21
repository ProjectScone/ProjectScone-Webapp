import {MarkdownText, SourceContent} from '../components/SourceContent';

export function ReplyContent({text}: {text: string}) {
  return <div className="conversation-reply-content">
    {text.length > 80000 ? <SourceContent text={text}/> : <MarkdownText text={text}/>}
  </div>;
}
