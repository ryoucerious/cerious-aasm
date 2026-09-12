import { Component, Input, OnChanges, ChangeDetectionStrategy } from '@angular/core';
import { NgIf } from '@angular/common';
import { areaPath, linePath, toPoints } from '../../core/utils/chart.utils';

/**
 * A tiny inline area chart with no axes — the "recent players" trace on a server card.
 * Pure SVG so it scales with its container and takes its colour from the parent.
 */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  template: `
    <svg class="sparkline" [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color" stop-opacity="0.45" />
          <stop offset="100%" [attr.stop-color]="color" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path *ngIf="area" [attr.d]="area" [attr.fill]="'url(#' + gradientId + ')'" />
      <path *ngIf="line" [attr.d]="line" fill="none" [attr.stroke]="color" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `,
  imports: [NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SparklineComponent implements OnChanges {
  @Input() values: number[] = [];
  @Input() color = 'var(--primary)';
  @Input() width = 300;
  @Input() height = 40;
  /** Optional fixed ceiling so several sparklines share a scale. */
  @Input() max?: number;

  line = '';
  area = '';
  readonly gradientId = `spark-${Math.random().toString(36).slice(2, 9)}`;

  ngOnChanges(): void {
    const values = Array.isArray(this.values) && this.values.length ? this.values : [0, 0];
    const points = toPoints(values, this.width, this.height, this.max, 2);
    this.line = linePath(points);
    this.area = areaPath(points, this.height, 2);
  }
}
