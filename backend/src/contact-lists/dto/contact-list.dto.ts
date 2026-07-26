import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ContactItemStatus } from '../contact-list.entity';

export class CreateContactListDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateContactListDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Raw CSV text plus the header names to read each field from. The browser
 * reads the file, so no multipart handling is needed on the server.
 */
export class ImportCsvDto {
  @IsNotEmpty()
  @IsString()
  csv: string;

  @IsNotEmpty()
  @IsString()
  phoneColumn: string;

  @IsOptional()
  @IsString()
  nameColumn?: string;

  @IsOptional()
  @IsString()
  emailColumn?: string;

  @IsOptional()
  @IsString()
  notesColumn?: string;
}

export class UpdateContactItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(ContactItemStatus)
  status?: ContactItemStatus;
}
