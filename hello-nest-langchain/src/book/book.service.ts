import { Injectable, Inject } from '@nestjs/common';
import { CreateBookDto } from './dto/create-book.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

@Injectable()
export class BookService {
  create(createBookDto: CreateBookDto) {
    return 'This action adds a new book';
  }

  @Inject('BOOK_REPOSITORY')
  private readonly bookRepository: any;
  findAll() {
    // return `This action returns all book`;
    return this.bookRepository.findAll();
  }

  findOne(id: number) {
    return `This action returns a #${id} book`;
  }

  update(id: number, updateBookDto: UpdateBookDto) {
    return `This action updates a #${id} book`;
  }

  remove(id: number) {
    return `This action removes a #${id} book`;
  }
}
