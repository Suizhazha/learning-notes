import { Module } from '@nestjs/common';
import { BookService } from './book.service.js';
import { BookController } from './book.controller.js';

@Module({
  controllers: [BookController],
  providers: [
    BookService,
    {
      provide: 'BOOK_REPOSITORY',
      useFactory(...args) {
        const books = [
          {
            id: 1,
            title: 'A Brief History of Time',
            author: 'Stephen Hawking',
          },
          {
            id: 2,
            title: 'Sapiens: A Brief History of Humankind',
            author: 'Yuval Noah Harari',
          },
          { id: 3, title: 'The Selfish Gene', author: 'Richard Dawkins' },
          {
            id: 4,
            title: 'On the Origin of Species',
            author: 'Charles Darwin',
          },
          {
            id: 5,
            title: 'A Brief History of Time',
            author: 'Stephen Hawking',
          },
        ];
        return { findAll: () => books };
      },
    },
  ],
})
export class BookModule {}
