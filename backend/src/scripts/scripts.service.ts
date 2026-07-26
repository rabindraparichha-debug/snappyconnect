import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallScript } from './call-script.entity';
import { CreateCallScriptDto, UpdateCallScriptDto } from './dto/call-script.dto';

@Injectable()
export class ScriptsService {
  constructor(
    @InjectRepository(CallScript)
    private readonly repo: Repository<CallScript>,
  ) {}

  /** Recruiters see only active scripts; admins managing them see all. */
  async findAll(includeInactive = false): Promise<CallScript[]> {
    return this.repo.find({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(dto: CreateCallScriptDto): Promise<CallScript> {
    return this.repo.save(
      this.repo.create({
        title: dto.title,
        body: dto.body,
        region: dto.region ?? null,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async update(id: string, dto: UpdateCallScriptDto): Promise<CallScript> {
    const script = await this.repo.findOne({ where: { id } });
    if (!script) throw new NotFoundException('Script not found');
    if (dto.title !== undefined) script.title = dto.title;
    if (dto.body !== undefined) script.body = dto.body;
    if (dto.region !== undefined) script.region = dto.region;
    if (dto.active !== undefined) script.active = dto.active;
    if (dto.sortOrder !== undefined) script.sortOrder = dto.sortOrder;
    return this.repo.save(script);
  }

  async remove(id: string): Promise<void> {
    const script = await this.repo.findOne({ where: { id } });
    if (!script) throw new NotFoundException('Script not found');
    await this.repo.remove(script);
  }
}
