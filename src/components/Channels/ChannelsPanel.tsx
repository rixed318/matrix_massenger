import React, { useMemo } from 'react';
import type { MatrixClient } from '@matrix-messenger/core';
import type { SpaceHierarchyNode } from '../../services/matrixService';
import KnowledgeBasePanel from '../KnowledgeBase/KnowledgeBasePanel';

interface ChannelsPanelProps {
    spaces: SpaceHierarchyNode[];
    selectedChannelId?: string | null;
    onSelectChannel?: (roomId: string, node: SpaceHierarchyNode) => void;
    isLoading?: boolean;
    emptyStateMessage?: string;
    className?: string;
    title?: string;
    client?: MatrixClient;
}

interface ChannelNodeProps {
    node: SpaceHierarchyNode;
    depth: number;
    selectedChannelId?: string | null;
    onSelect?: (node: SpaceHierarchyNode) => void;
}

const ChannelTreeNode: React.FC<ChannelNodeProps> = ({ node, depth, selectedChannelId, onSelect }) => {
    const metadata: string[] = [];
    if (typeof node.numJoinedMembers === 'number') {
        metadata.push(`${node.numJoinedMembers} member${node.numJoinedMembers === 1 ? '' : 's'}`);
    }
    if (node.worldReadable) {
        metadata.push('Public');
    }
    if (node.relation?.suggested) {
        metadata.push('Suggested');
    }

    const indent = depth * 1.25;
    const isSelected = node.roomId === selectedChannelId;
    const handleSelect = () => onSelect?.(node);

    const selectable = typeof onSelect === 'function';

    return (
        <div key={node.roomId} className="space-y-1">
            <button
                type="button"
                onClick={handleSelect}
                style={{ paddingLeft: `${indent}rem` }}
                disabled={!selectable}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors flex flex-col gap-1 border border-transparent ${
                    isSelected
                        ? 'bg-accent/10 text-text-primary border-accent'
                        : selectable
                            ? 'bg-bg-secondary/60 hover:bg-bg-secondary text-text-primary'
                            : 'bg-bg-secondary/60 text-text-secondary cursor-default'
                }`}
            >
                <div className="flex items-center gap-2">
                    <span
                        className={`flex items-center justify-center rounded-md ${
                            node.isSpace ? 'bg-bg-tertiary text-text-secondary' : 'bg-accent/10 text-text-accent'
                        } h-6 w-6 text-xs font-semibold`}
                    >
                        {node.isSpace ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M3 3a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2V3zm8 0a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2V3zM3 13a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4zm8 0a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z" />
                            </svg>
                        ) : (
                            '#'
                        )}
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{node.name}</p>
                        <p className="text-xs text-text-secondary truncate">{node.roomId}</p>
                    </div>
                </div>
                {node.topic && (
                    <p className="text-xs text-text-secondary truncate" title={node.topic}>
                        {node.topic}
                    </p>
                )}
                {metadata.length > 0 && (
                    <div className="flex flex-wrap gap-1 text-[10px] uppercase tracking-wide text-text-secondary">
                        {metadata.map(item => (
                            <span key={item} className="bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                {item}
                            </span>
                        ))}
                    </div>
                )}
            </button>
            {node.children.length > 0 && (
                <div className="space-y-1">
                    {node.children.map(child => (
                        <ChannelTreeNode
                            key={child.roomId}
                            node={child}
                            depth={depth + 1}
                            selectedChannelId={selectedChannelId}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const ChannelsPanel: React.FC<ChannelsPanelProps> = ({
    spaces,
    selectedChannelId,
    onSelectChannel,
    isLoading = false,
    emptyStateMessage = 'No channels available',
    className = '',
    title = 'Channels',
    client,
}) => {
    const flattenedCount = useMemo(() => {
        const stack = [...spaces];
        let count = 0;
        while (stack.length) {
            const node = stack.pop()!;
            if (!node.isSpace) {
                count += 1;
            }
            stack.push(...node.children);
        }
        return count;
    }, [spaces]);

    const handleSelect = (node: SpaceHierarchyNode) => {
        onSelectChannel?.(node.roomId, node);
    };

    return (
        <section className={`bg-bg-primary border border-border-primary rounded-lg p-4 space-y-4 ${className}`}>
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                    <p className="text-xs text-text-secondary">{flattenedCount} readable channel{flattenedCount === 1 ? '' : 's'}</p>
                </div>
            </header>

            {isLoading ? (
                <div className="text-sm text-text-secondary">Loading space hierarchy…</div>
            ) : spaces.length === 0 ? (
                <div className="text-sm text-text-secondary">{emptyStateMessage}</div>
            ) : (
                <div className="space-y-2">
                    {spaces.map(space => (
                        <ChannelTreeNode
                            key={space.roomId}
                            node={space}
                            depth={0}
                            selectedChannelId={selectedChannelId}
                            onSelect={handleSelect}
                        />
                    ))}
                </div>
            )}
            <KnowledgeBasePanel client={client} className="mt-2" />
        </section>
    );
};

export default ChannelsPanel;
