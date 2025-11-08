import React from 'react';
import { Poll } from '../types';

interface PollViewProps {
    poll: Poll;
    onVote: (optionId: string) => void;
}

const PollView: React.FC<PollViewProps> = ({ poll, onVote }) => {
    const totalVotes = Object.values(poll.results).reduce((sum, result) => sum + result.votes, 0);

    return (
        <div className="space-y-3 w-full max-w-md">
            <p className="font-bold text-white">{poll.question}</p>
            <div className="space-y-2">
                {poll.options.map(option => {
                    const result = poll.results[option.id] || { votes: 0 };
                    const percentage = totalVotes > 0 ? (result.votes / totalVotes) * 100 : 0;
                    const hasVoted = !!poll.userVote;
                    const isMyVote = poll.userVote === option.id;

                    return (
                        <button
                            key={option.id}
                            onClick={() => onVote(option.id)}
                            disabled={hasVoted}
                            className={`w-full text-left p-2 rounded-md transition-colors relative overflow-hidden ${
                                hasVoted 
                                ? (isMyVote ? 'ring-2 ring-indigo-400' : 'opacity-80')
                                : 'bg-gray-900/50 hover:bg-gray-900/80 cursor-pointer'
                            }`}
                        >
                            {hasVoted && (
                                <div 
                                    className="absolute top-0 left-0 h-full bg-indigo-500/30"
                                    style={{ width: `${percentage}%` }}
                                ></div>
                            )}
                            <div className="relative z-10 flex justify-between items-center">
                                <span className="font-medium">{option.text}</span>
                                {hasVoted && (
                                     <div className="flex items-center gap-2">
                                        {isMyVote && (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-300" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        <span className="font-semibold">{Math.round(percentage)}%</span>
                                        <span className="text-sm text-gray-300">({result.votes})</span>
                                     </div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
            <p className="text-xs text-gray-400">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</p>
        </div>
    );
};

export default PollView;
