import { IsString, Length } from 'class-validator';
import { SUBSCRIPTION_ID_MAX_LENGTH } from '../constants.js';

export class SubscriptionIdParams {
  @IsString()
  @Length(1, SUBSCRIPTION_ID_MAX_LENGTH)
  id: string;
}
