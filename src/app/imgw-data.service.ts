import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface Station {
  code: string;
  name: string;
}

export interface ApiStatus {
  last_sync: string | null;
  files: string[];
}

export interface WeatherRecord {
  station_code: string;
  station_name: string;
  date: string;
  year: number;
  month: number;
  day: number;
  tmax: number | null;
  tmin: number | null;
  tavg: number | null;
  tmin_ground: number | null;
  precipitation: number | null;
  precipitation_type: string | null;
  snow_depth: number | null;
  tmax_status: string | null;
  tmin_status: string | null;
  tavg_status: string | null;
  tmin_ground_status: string | null;
  precipitation_status: string | null;
  snow_depth_status: string | null;
  tmaxmin: string | null;
}

@Injectable({ providedIn: 'root' })
export class ImgDataService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api';

  getStations(): Observable<Station[]> {
    return this.http.get<Station[]>(`${this.apiUrl}/stations`);
  }

  getStatus(): Observable<ApiStatus> {
    return this.http.get<ApiStatus>(`${this.apiUrl}/status`);
  }

  getData(station: string, year: number): Observable<WeatherRecord[]> {
    const params = new HttpParams().set('station', station).set('year', year);
    return this.http.get<WeatherRecord[]>(`${this.apiUrl}/data`, { params }).pipe(map(data => data.map(record => ({...record, tmaxmin: record.tmin !== null && record.tmax !== null ? `${record.tmax} / ${record.tmin}` : null}))));
  }
}
