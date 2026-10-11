import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { Chart, ChartDataset } from 'chart.js/auto';
import zoomPlugin from 'chartjs-plugin-zoom';
import { WeatherRecord } from './imgw-data.service';

Chart.register(zoomPlugin);

type ChartMeasurement = 'tmax' | 'tmin' | 'tavg' | 'tmin_ground' | 'precipitation' | 'snow_depth';

interface MetricConfig {
  key: ChartMeasurement;
  label: string;
  type: 'line' | 'bar';
  axis: 'y' | 'y1';
  color: string;
}

const METRICS: MetricConfig[] = [
  { key: 'tmax', label: 'T maks. (°C)', type: 'line', axis: 'y', color: '#e53935' },
  { key: 'tmin', label: 'T min. (°C)', type: 'line', axis: 'y', color: '#1e88e5' },
  { key: 'tavg', label: 'T śr. (°C)', type: 'line', axis: 'y', color: '#fb8c00' },
  { key: 'tmin_ground', label: 'T przy gruncie (°C)', type: 'line', axis: 'y', color: '#8e24aa' },
  { key: 'precipitation', label: 'Opad (mm)', type: 'bar', axis: 'y1', color: '#42a5f5' },
  { key: 'snow_depth', label: 'Pokrywa śnieżna (cm)', type: 'bar', axis: 'y1', color: '#90a4ae' },
];

const DEFAULT_METRICS: ChartMeasurement[] = ['tmax', 'tmin', 'precipitation'];

// Reuse the same colors as the "Pogoda" column icons, so a bar's color always
// matches what the user already associates with snow/rain in the table.
const SNOW_COLOR = '#4fc3f7';
const RAIN_COLOR = '#1565c0';
const NEUTRAL_COLOR = 'rgba(66, 165, 245, 0.35)';

const PREVIOUS_YEAR_COLOR = '#e76f00';

@Component({
  selector: 'app-weather-chart',
  imports: [MatCheckboxModule],
  templateUrl: './weather-chart.component.html',
  styleUrl: './weather-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeatherChartComponent implements OnDestroy {
  readonly records = input<WeatherRecord[]>([]);
  readonly previousYearRecords = input<WeatherRecord[]>([]);
  readonly stationLabel = input<string>('');
  readonly showPreviousYear = input<boolean>(false);

  readonly metrics = METRICS;
  readonly selectedMetrics = signal<Set<ChartMeasurement>>(new Set(DEFAULT_METRICS));

  readonly chartRecords = computed(() => [...this.records()].sort((a, b) => a.date.localeCompare(b.date)));

  // Keyed by "MM-DD" so a previous-year value can be looked up for the same
  // calendar day regardless of the (different) year in its date string.
  private readonly previousYearByDay = computed(() => {
    const map = new Map<string, WeatherRecord>();
    for (const record of this.previousYearRecords()) {
      map.set(record.date.slice(5), record);
    }
    return map;
  });

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  constructor() {
    effect(() => {
      const canvas = this.canvasRef()?.nativeElement;
      const records = this.chartRecords();
      const selected = this.selectedMetrics();
      const previousYearByDay = this.previousYearByDay();
      const showPreviousYear = this.showPreviousYear();
      if (!canvas) return;
      this.renderChart(canvas, records, selected, showPreviousYear ? previousYearByDay : null);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  isSelected(key: ChartMeasurement): boolean {
    return this.selectedMetrics().has(key);
  }

  toggleMetric(key: ChartMeasurement, change: MatCheckboxChange): void {
    const next = new Set(this.selectedMetrics());
    if (change.checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.selectedMetrics.set(next);
  }

  resetZoom(): void {
    this.chart?.resetZoom();
  }

  private renderChart(
    canvas: HTMLCanvasElement,
    records: WeatherRecord[],
    selected: Set<ChartMeasurement>,
    previousYearByDay: Map<string, WeatherRecord> | null,
  ): void {
    const labels = records.map((record) => record.date);
    const activeMetrics = METRICS.filter((metric) => selected.has(metric.key));

    const datasets: ChartDataset<'line' | 'bar', (number | null)[]>[] = activeMetrics.map((metric) => ({
      type: metric.type,
      label: metric.label,
      data: records.map((record) => record[metric.key]),
      yAxisID: metric.axis,
      borderColor: metric.color,
      backgroundColor:
        metric.key === 'precipitation'
          ? records.map((record) => this.precipitationColor(record.precipitation_type))
          : metric.color,
      spanGaps: true,
      tension: 0.25,
      order: metric.type === 'line' ? 0 : 1,
    }));

    if (previousYearByDay) {
      for (const metric of activeMetrics) {
        datasets.push({
          type: metric.type,
          label: `${metric.label} – ubiegły rok`,
          data: records.map((record) => previousYearByDay.get(record.date.slice(5))?.[metric.key] ?? null),
          yAxisID: metric.axis,
          borderColor: PREVIOUS_YEAR_COLOR,
          backgroundColor: PREVIOUS_YEAR_COLOR,
          borderDash: metric.type === 'line' ? [6, 4] : undefined,
          pointRadius: metric.type === 'line' ? 0 : undefined,
          spanGaps: true,
          tension: 0.25,
          order: metric.type === 'line' ? 2 : 3,
        });
      }
    }

    if (this.chart && this.chart.canvas !== canvas) {
      // The canvas element was recreated (e.g. the chart was briefly hidden
      // behind the "no data" message while switching stations), so the old
      // Chart.js instance is no longer attached to anything on screen.
      this.chart.destroy();
      this.chart = null;
    }

    if (this.chart) {
      const currentLabels = this.chart.data.labels ?? [];
      const labelsChanged =
        currentLabels.length !== labels.length || currentLabels.some((label, index) => label !== labels[index]);
      if (labelsChanged) {
        this.chart.destroy();
        this.chart = null;
      }
    }

    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets = datasets;
      this.chart.update();
      return;
    }

    this.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          zoom: {
            limits: {
              x: { min: 0, max: labels.length - 1 },
            },
            zoom: {
              wheel: { enabled: true },
              mode: 'x',
            },
            pan: {
              enabled: true,
              mode: 'x',
            },
          },
        },
        scales: {
          x: { type: 'category' },
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Temperatura (°C)' },
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: { display: true, text: 'Opad / śnieg (mm, cm)' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  private precipitationColor(type: string | null): string {
    if (type === 'S') return SNOW_COLOR;
    if (type === 'W') return RAIN_COLOR;
    return NEUTRAL_COLOR;
  }
}
