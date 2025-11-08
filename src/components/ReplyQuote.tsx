import React from 'react';

interface ReplyQuoteProps {
    sender: string;
    body: string;
}

const ReplyQuote: React.FC<ReplyQuoteProps> = ({ sender, body }) => {
    return (
        <div className="relative pl-2 border-l-2 border-text-accent mb-2 opacity-80">
            <p className="text-sm font-bold text-text-accent">{sender}</p>
            <p className="text-sm text-text-secondary truncate">{body}</p>
        </div>
    );
};

export default ReplyQuote;