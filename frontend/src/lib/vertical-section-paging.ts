export type SectionPagingState = {
  index: number;
  count: number;
  busy: boolean;
  atTop: boolean;
  atBottom: boolean;
};

/** Edge paging, like Dreams: scroll content first, then move one section per gesture. */
export class VerticalSectionPaging {
  private distance = 0;
  private lastWheel = -Infinity;
  private lockedUntil = 0;
  private touch: { x: number; y: number; state: SectionPagingState } | null =
    null;

  lock(now: number) {
    this.lockedUntil = now + 360;
    this.distance = 0;
    this.touch = null;
  }

  wheel(
    dx: number,
    dy: number,
    now: number,
    state: SectionPagingState,
  ): number | null {
    const idle = now - this.lastWheel > 180;
    this.lastWheel = now;
    if (now < this.lockedUntil) {
      this.lockedUntil = Math.max(this.lockedUntil, now + 180);
      return null;
    }
    if (
      state.busy ||
      !dy ||
      Math.abs(dx) >= Math.abs(dy) ||
      (dy > 0 ? !state.atBottom : !state.atTop)
    ) {
      this.distance = 0;
      return null;
    }
    if (idle || Math.sign(this.distance) !== Math.sign(dy)) this.distance = 0;
    this.distance += dy;
    if (Math.abs(this.distance) < 64) return null;
    this.distance = 0;
    return this.next(dy > 0 ? 1 : -1, now, state);
  }

  startTouch(x: number, y: number, state: SectionPagingState) {
    this.touch = state.busy ? null : { x, y, state: { ...state } };
  }

  cancelTouch() {
    this.touch = null;
  }

  endTouch(
    x: number,
    y: number,
    now: number,
    current: SectionPagingState,
  ): number | null {
    const start = this.touch;
    this.touch = null;
    if (
      !start ||
      current.busy ||
      current.index !== start.state.index ||
      now < this.lockedUntil
    )
      return null;
    const distance = start.y - y;
    if (Math.abs(distance) <= 48 || Math.abs(x - start.x) >= Math.abs(distance))
      return null;
    if (distance > 0 ? !start.state.atBottom : !start.state.atTop) return null;
    return this.next(distance > 0 ? 1 : -1, now, current);
  }

  private next(
    step: -1 | 1,
    now: number,
    state: SectionPagingState,
  ): number | null {
    const index = state.index + step;
    if (state.busy || index < 0 || index >= state.count) return null;
    this.lock(now);
    return index;
  }
}
