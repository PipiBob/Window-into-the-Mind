export type Role = 'objective' | 'novelty' | 'method' | 'result' | 'caveat';
export type Box = [number, number, number, number];
export interface Anchor {page: number; boxes: Box[]; text: string; text_range?: [number, number]; region?: string}
export interface Candidate {id: string; role: Role; anchors: Anchor[]; label: string; purpose?: string; related_to: string[]}
export interface Block {id: string; page: number; box: Box; candidate_ids: string[]}
export interface SemanticRegion {id: string; page: number; label: string; target: string; box: Box; anchor_index: number}
export interface Stop {id: string; title: string; context: string[]; note?: string}
export interface Paper {id: string; title: string; shortTitle: string; skill: string; annotations: string; pdf: string}
export interface Manifest {id: string; candidates: Candidate[]; blocks: Block[]; pages: unknown[]; source: {sha256: string}; opening: string[]; opening_note?: string; semantic_regions?: SemanticRegion[]; route: Stop[]; provenance: {skill: string}}
export type Mode = 'focus' | 'explore' | 'original';
export interface Selection {mode: Mode; enabled: Set<Role>; overrides: Map<string, boolean>; selected: string | null; stopIndex: number}
export interface Snapshot {library: Paper[]; paper: string; data: Manifest | null; selection: Selection | null; ready: boolean; page: number; pages: number; status: string; original: string}
