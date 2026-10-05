import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  login!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  password!: string;
}
