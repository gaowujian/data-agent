import * as XLSX from 'xlsx'

export function createXlsxFixture(): Buffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['old', 3, null],
      ['value', 4, 'extra'],
    ]),
    'Data',
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['name'], ['other']]),
    'Other',
  )
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}
