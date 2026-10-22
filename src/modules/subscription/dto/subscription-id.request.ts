import { IsString, Length } from 'class-validator';
import { SUBSCRIPTION_ID_MAX_LENGTH } from '../constants.js';
import { IsWithoutNul } from './request-input.js';

export class SubscriptionIdParams {
  @IsString()
  @Length(1, SUBSCRIPTION_ID_MAX_LENGTH)
  @IsWithoutNul()
  id: string;
}
