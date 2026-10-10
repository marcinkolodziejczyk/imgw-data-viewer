import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ImgDataService, Station, WeatherRecord } from './imgw-data.service';
import { DEFAULT_STATION_NAME } from './app.config';
import { WeatherChartComponent } from './weather-chart.component';

type Measurement = 'tmax' | 'tmin' | 'tavg' | 'tmin_ground' | 'precipitation' | 'snow_depth';
type WeatherColumn =
  | 'date'
  | 'station_name'
  | 'station_code'
  | Measurement
  | 'precipitation_type'
  | 'tmaxmin'
  | 'weather_icon';

interface ColumnOption {
  key: WeatherColumn;
  label: string;
}

@Component({
  selector: 'app-root',
  imports: [
    DragDropModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    WeatherChartComponent,
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly dataService = inject(ImgDataService);

  readonly stations = signal<Station[]>([]);
  readonly availableYears = signal<number[]>([]);
  readonly selectedStations = signal<string[]>([]);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly selectedMeasurement = signal<Measurement | ''>('');
  readonly minValue = signal<number | null>(null);
  readonly maxValue = signal<number | null>(null);
  readonly records = signal<WeatherRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly comparePreviousYear = signal(false);
  readonly previousYearRecords = signal<WeatherRecord[]>([]);
  readonly previousYearLoading = signal(false);

  readonly ALL_STATIONS = '__ALL__';

  readonly isAllStationsSelected = computed(
    () => this.stations().length > 0 && this.selectedStations().length === this.stations().length,
  );

  readonly stationSelectModel = computed(() =>
    this.isAllStationsSelected() ? [this.ALL_STATIONS, ...this.selectedStations()] : this.selectedStations(),
  );

  readonly measurements: { key: Measurement; label: string }[] = [
    { key: 'tmax', label: 'Temperatura maksymalna (°C)' },
    { key: 'tmin', label: 'Temperatura minimalna (°C)' },
    { key: 'tavg', label: 'Temperatura średnia (°C)' },
    { key: 'tmin_ground', label: 'Temperatura przy gruncie (°C)' },
    { key: 'precipitation', label: 'Opad (mm)' },
    { key: 'snow_depth', label: 'Pokrywa śnieżna (cm)' },
  ];

  readonly columns: ColumnOption[] = [
    { key: 'date', label: 'Data' },
    { key: 'station_name', label: 'Stacja' },
    { key: 'station_code', label: 'Kod stacji' },
    { key: 'tmax', label: 'T maks. (°C)' },
    { key: 'tmin', label: 'T min. (°C)' },
    { key: 'tavg', label: 'T śr. (°C)' },
    { key: 'tmaxmin', label: 'T maks./min. (°C)' },
    { key: 'tmin_ground', label: 'T przy gruncie (°C)' },
    { key: 'precipitation', label: 'Opad (mm)' },
    { key: 'precipitation_type', label: 'Rodzaj opadu' },
    { key: 'weather_icon', label: 'Pogoda' },
    { key: 'snow_depth', label: 'Pokrywa śnieżna (cm)' },
  ];
  readonly visibleColumns = signal<WeatherColumn[]>([
    'date',
    'station_name',
    'tmax',
    'tmin',
    'tavg',
    'precipitation',
    'precipitation_type',
    'weather_icon',
  ]);

  readonly filteredRecords = computed(() => {
    const measurement = this.selectedMeasurement();
    const min = this.minValue();
    const max = this.maxValue();
    return this.records().filter((record) => {
      if (!measurement) return true;
      const value = record[measurement];
      if (value === null) return false;
      return (min === null || value >= min) && (max === null || value <= max);
    });
  });

  readonly chartStationCode = computed(() => this.selectedStations()[0] ?? null);

  readonly chartStationLabel = computed(() => {
    const code = this.chartStationCode();
    if (!code) return '';
    return this.stations().find((station) => station.code === code)?.name ?? code;
  });

  readonly chartRecords = computed(() => {
    const code = this.chartStationCode();
    if (!code) return [];
    return this.filteredRecords().filter((record) => record.station_code === code);
  });

  readonly chartPreviousYearRecords = computed(() => {
    const code = this.chartStationCode();
    if (!code) return [];
    return this.previousYearRecords().filter((record) => record.station_code === code);
  });

  // Keyed by "station_code|MM-DD" so the table can look up "what was this
  // station's value on the same calendar day last year" for any row.
  private readonly previousYearByKey = computed(() => {
    const map = new Map<string, WeatherRecord>();
    for (const record of this.previousYearRecords()) {
      map.set(`${record.station_code}|${record.date.slice(5)}`, record);
    }
    return map;
  });

  private readonly previousYearExcludedColumns = new Set<WeatherColumn>([
    'date',
    'station_name',
    'station_code',
  ]);

  readonly sortState = signal<Sort>({ active: 'date', direction: 'asc' });

  readonly sortedRecords = computed(() => {
    const { active, direction } = this.sortState();
    const data = [...this.filteredRecords()];
    if (!active || !direction) return data;
    const factor = direction === 'asc' ? 1 : -1;
    const column = active as WeatherColumn;
    return data.sort((a, b) => factor * this.compareRecords(a, b, column));
  });

  constructor() {
    void this.loadInitialData();
  }

  async loadInitialData(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [stations, status] = await Promise.all([
        firstValueFrom(this.dataService.getStations()),
        firstValueFrom(this.dataService.getStatus()),
      ]);
      this.stations.set(stations);
      const availableYears = [...new Set(
        status.files
          .map((file) => file.match(/_(\d{4})\.csv$/i)?.[1])
          .filter((year): year is string => year !== undefined)
          .map(Number),
      )].sort((a, b) => a - b);
      this.availableYears.set(availableYears);

      if (stations.length === 0) return;

      const latestYear = availableYears.at(-1) ?? new Date().getFullYear();
      const today = new Date().toISOString().slice(0, 10);
      const defaultStation = stations.find((s) => s.name.toUpperCase() === DEFAULT_STATION_NAME) ?? stations[0];
      this.selectedStations.set([defaultStation.code]);
      this.fromDate.set(`${latestYear}-01-01`);
      this.toDate.set(today.startsWith(`${latestYear}-`) ? today : `${latestYear}-12-31`);
      await this.search();
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async search(): Promise<void> {
    const stationCodes = this.selectedStations();
    const from = this.fromDate();
    const to = this.toDate();
    if (stationCodes.length === 0 || !from || !to) {
      this.error.set('Wybierz co najmniej jedną stację i podaj obie daty.');
      return;
    }
    if (from > to) {
      this.error.set('Data początkowa nie może być późniejsza od końcowej.');
      return;
    }
    if (this.minValue() !== null && this.maxValue() !== null && this.minValue()! > this.maxValue()!) {
      this.error.set('Wartość minimalna nie może być większa od maksymalnej.');
      return;
    }

    this.loading.set(true);
    this.error.set('');
    this.records.set([]);
    try {
      const firstYear = Number(from.slice(0, 4));
      const lastYear = Number(to.slice(0, 4));
      const years = this.availableYears().filter((year) => year >= firstYear && year <= lastYear);
      const results = await Promise.all(
        stationCodes.flatMap((station) =>
          years.map((year) => firstValueFrom(this.dataService.getData(station, year))),
        ),
      );
      this.records.set(
        results
          .flat()
          .filter((record) => record.date >= from && record.date <= to)
          .sort((a, b) => a.date.localeCompare(b.date) || a.station_name.localeCompare(b.station_name)),
      );
      if (this.comparePreviousYear()) {
        await this.loadPreviousYearData();
      }
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async onTogglePreviousYear(enabled: boolean): Promise<void> {
    this.comparePreviousYear.set(enabled);
    if (enabled) {
      await this.loadPreviousYearData();
    }
  }

  private async loadPreviousYearData(): Promise<void> {
    const stationCodes = this.selectedStations();
    const from = this.fromDate();
    const to = this.toDate();
    if (stationCodes.length === 0 || !from || !to) {
      this.previousYearRecords.set([]);
      return;
    }
    const prevFrom = this.shiftYear(from, -1);
    const prevTo = this.shiftYear(to, -1);
    this.previousYearLoading.set(true);
    try {
      const firstYear = Number(prevFrom.slice(0, 4));
      const lastYear = Number(prevTo.slice(0, 4));
      const years = this.availableYears().filter((year) => year >= firstYear && year <= lastYear);
      // Fetched for every selected station (not just the chart's station), so the
      // table can also show the faded previous-year value for each visible row.
      const results = await Promise.all(
        stationCodes.flatMap((station) =>
          years.map((year) => firstValueFrom(this.dataService.getData(station, year))),
        ),
      );
      this.previousYearRecords.set(
        results.flat().filter((record) => record.date >= prevFrom && record.date <= prevTo),
      );
    } catch {
      // Comparison data is a non-essential extra: fail silently and simply
      // show the chart/table without the previous-year overlay.
      this.previousYearRecords.set([]);
    } finally {
      this.previousYearLoading.set(false);
    }
  }

  private shiftYear(dateStr: string, delta: number): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    return `${year + delta}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  onSortChange(sort: Sort): void {
    this.sortState.set(sort);
  }

  private compareRecords(a: WeatherRecord, b: WeatherRecord, column: WeatherColumn): number {
    if (column === 'tmaxmin') {
      const byTmax = this.compareNullable(a.tmax, b.tmax);
      return byTmax !== 0 ? byTmax : this.compareNullable(a.tmin, b.tmin);
    }
    if (column === 'weather_icon') {
      return this.compareNullable(a.precipitation_type, b.precipitation_type);
    }
    return this.compareNullable(a[column], b[column]);
  }

  private compareNullable(a: number | string | null, b: number | string | null): number {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'pl');
  }

  onStationsChange(selected: string[]): void {
    const wasAllSelected = this.isAllStationsSelected();
    const hasAllOption = selected.includes(this.ALL_STATIONS);
    const realSelected = selected.filter((code) => code !== this.ALL_STATIONS);

    if (hasAllOption && !wasAllSelected) {
      // Użytkownik zaznaczył opcję "Zaznacz wszystkie" – wybieramy wszystkie stacje.
      this.selectedStations.set(this.stations().map((s) => s.code));
      return;
    }
    if (!hasAllOption && wasAllSelected && realSelected.length === this.selectedStations().length) {
      // Użytkownik odznaczył "Zaznacz wszystkie" bez dotykania pojedynczych stacji – czyścimy wybór.
      this.selectedStations.set([]);
      return;
    }
    this.selectedStations.set(realSelected);
  }

  setVisibleColumns(selected: WeatherColumn[]): void {
    if (selected.length === 0) {
      this.visibleColumns.set(['date']);
      return;
    }
    const current = this.visibleColumns();
    const kept = current.filter((key) => selected.includes(key));
    const added = selected.filter((key) => !current.includes(key));
    this.visibleColumns.set([...kept, ...added]);
  }

  dropColumn(event: CdkDragDrop<WeatherColumn[]>): void {
    const columns = [...this.visibleColumns()];
    moveItemInArray(columns, event.previousIndex, event.currentIndex);
    this.visibleColumns.set(columns);
  }

  removeColumn(key: WeatherColumn): void {
    const remaining = this.visibleColumns().filter((column) => column !== key);
    if (remaining.length === 0) return;
    this.visibleColumns.set(remaining);
  }

  columnLabel(key: WeatherColumn): string {
    return this.columns.find((column) => column.key === key)?.label ?? key;
  }

  exportCsv(): void {
    const columns = this.visibleColumns();
    const rows = this.sortedRecords();
    if (columns.length === 0 || rows.length === 0) return;

    const lines = [
      columns.map((key) => this.csvEscape(this.columnLabel(key))).join(';'),
      ...rows.map((record) =>
        columns.map((key) => this.csvEscape(this.formatCell(record, key))).join(';'),
      ),
    ];
    const csvContent = '\ufeff' + lines.join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stationCodes = this.selectedStations();
    const station =
      stationCodes.length === 1
        ? (this.stations().find((s) => s.code === stationCodes[0])?.name ?? stationCodes[0])
        : `${stationCodes.length}_stacji`;
    link.href = url;
    link.download = `imgw_${station}_${this.fromDate()}_${this.toDate()}.csv`.replace(/\s+/g, '_');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private csvEscape(value: string): string {
    if (value === '—') return '';
    if (/[";\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  formatCell(record: WeatherRecord, column: WeatherColumn): string {
    if (column === 'weather_icon') {
      return this.formatCell(record, 'precipitation_type');
    }
    const value = record[column];
    if (value === null || value === undefined || value === '') return '—';
    if (column === 'precipitation_type') {
      return value === 'S' ? 'Śnieg' : value === 'W' ? 'Deszcz' : String(value);
    }
    return typeof value === 'number'
      ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 })
      : String(value);
  }

  supportsPreviousYear(column: WeatherColumn): boolean {
    return !this.previousYearExcludedColumns.has(column);
  }

  previousYearRecordFor(record: WeatherRecord): WeatherRecord | undefined {
    return this.previousYearByKey().get(`${record.station_code}|${record.date.slice(5)}`);
  }

  previousYearCellText(record: WeatherRecord, column: WeatherColumn): string {
    const previous = this.previousYearRecordFor(record);
    return previous ? this.formatCell(previous, column) : '—';
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = error.error;
      if (typeof response === 'object' && response !== null && 'detail' in response) {
        return String(response.detail);
      }
    }
    return 'Nie udało się połączyć z API IMGW. Sprawdź, czy serwer działa pod adresem localhost:8000.';
  }
}
