// Import necessary modules
import { prisma } from '../../../prisma';

// Base where condition
const baseWhere = { ... }; // Presuming baseWhere is defined somewhere else in the file

export async function getTotalProducts() {
  return await prisma.product.findMany({
    where: { ...baseWhere, status: 'ACTIVE' },
  }).then(products => products.length);
}