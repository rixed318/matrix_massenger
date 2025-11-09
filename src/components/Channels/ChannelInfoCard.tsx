import React from 'react';
import type { SpaceHierarchyNode } from '../../services/matrixService';

interface ChannelInfoCardProps {
    node?: SpaceHierarchyNode | null;
    className?: string;
    showHierarchyMeta?: boolean;
}

const ChannelInfoCard: React.FC<ChannelInfoCardProps> = ({ node, className = '', showHierarchyMeta = true }) => {
    if (!node) {
        return (
            <div className={`border border-border-primary rounded-lg bg-bg-primary p-6 text-sm text-text-secondary ${className}`}>
                Select a channel to view its details.
            </div>
        );
    }

    const relationBadges: string[] = [];
    if (node.isSpace) {
        relationBadges.push('Space');
    }
    if (node.relation?.suggested) {
        relationBadges.push('Suggested');
    }
    if (node.worldReadable) {
        relationBadges.push('World readable');
    }
    if (node.guestCanJoin) {
        relationBadges.push('Guests allowed');
    }

    if (typeof node.numJoinedMembers === 'number') {
        relationBadges.push(`${node.numJoinedMembers} member${node.numJoinedMembers === 1 ? '' : 's'}`);
    }

    return (
        <section className={`border border-border-primary rounded-lg bg-bg-primary p-6 space-y-4 ${className}`}>
            <header className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-text-primary truncate">{node.name}</h2>
                        <p className="text-xs text-text-secondary break-all">{node.roomId}</p>
                    </div>
                    {relationBadges.length > 0 && (
                        <div className="flex flex-wrap gap-1 justify-end">
                            {relationBadges.map(badge => (
                                <span key={badge} className="text-[10px] uppercase tracking-wide bg-bg-tertiary text-text-secondary px-2 py-1 rounded-full">
                                    {badge}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                {node.topic && <p className="text-sm text-text-secondary whitespace-pre-line">{node.topic}</p>}
            </header>

            <dl className="grid grid-cols-1 gap-3 text-sm text-text-secondary">
                {node.canonicalAlias && (
                    <div>
                        <dt className="font-semibold text-text-primary">Canonical alias</dt>
                        <dd className="break-all">{node.canonicalAlias}</dd>
                    </div>
                )}
                {showHierarchyMeta && node.relation?.order && (
                    <div>
                        <dt className="font-semibold text-text-primary">Order</dt>
                        <dd>{node.relation.order}</dd>
                    </div>
                )}
                {showHierarchyMeta && node.relation?.viaServers?.length ? (
                    <div>
                        <dt className="font-semibold text-text-primary">Via servers</dt>
                        <dd className="flex flex-wrap gap-1">
                            {node.relation.viaServers.map(server => (
                                <span key={server} className="px-2 py-0.5 bg-bg-tertiary rounded-full text-xs">{server}</span>
                            ))}
                        </dd>
                    </div>
                ) : null}
                {showHierarchyMeta && node.parentIds.length > 0 && (
                    <div>
                        <dt className="font-semibold text-text-primary">Parent spaces</dt>
                        <dd className="text-xs break-all leading-relaxed">
                            {node.parentIds.join(', ')}
                        </dd>
                    </div>
                )}
                {node.children.length > 0 && (
                    <div>
                        <dt className="font-semibold text-text-primary">Sub-channels</dt>
                        <dd className="text-xs text-text-secondary">
                            {node.children.map(child => child.name || child.roomId).join(', ')}
                        </dd>
                    </div>
                )}
            </dl>
        </section>
    );
};

export default ChannelInfoCard;
