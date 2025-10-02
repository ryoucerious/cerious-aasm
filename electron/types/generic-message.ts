export interface GenericMessage {
  channel: string;
  payload: any;
}

export interface GenericResponse {
  status: string;
  channel: string;
  payload: any;
}
