// written by `raea cut`: the clips, in order, in each take's own seconds. Re-run raea cut to change them, or edit
// by hand (the edit reads only this file). cuts.json beside it is the same list for raea's checks.


export const edit = {"width":1080,"height":1920,"fps":30};
export type Cut = { take: string; src: string; from: number; to: number; line: string; kind: "video" | "audio" };
export const cuts: Cut[] = [

];
/** a clip's length in the edit's frames */
export const frames = (c: Cut) => Math.max(1, Math.round((c.to - c.from) * edit.fps));
/** the cuts end to end, in frames */
export const total = cuts.reduce((n, c) => n + frames(c), 0);
