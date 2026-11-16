import { IsString, Length } from 'class-validator';
import { FLOORPLAN_ID_MAX_LENGTH } from '../constants.js';
import { IsWithoutNul } from './request-input.js';

export class FloorplanIdParams {
  @IsString()
  @Length(1, FLOORPLAN_ID_MAX_LENGTH)
  @IsWithoutNul()
  id: string;
}
