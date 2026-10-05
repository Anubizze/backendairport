import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  flightId!: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}
