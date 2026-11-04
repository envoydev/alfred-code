import { csvField, toCsv } from './report-csv';

describe('report CSV', () => {
  it('writes a header line and one line per row', () => {
    expect(toCsv([{ id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120 }])).toBe('id,customer,status,total\n1,Ada Lovelace,Pending,120.00\n');
  });

  it('writes only the header for no rows', () => {
    expect(toCsv([])).toBe('id,customer,status,total\n');
  });

  it('quotes a field holding a comma, a quote or a line break', () => {
    expect(csvField('Hopper, Grace')).toBe('"Hopper, Grace"');
    expect(csvField('The "Admiral"')).toBe('"The ""Admiral"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('plain')).toBe('plain');
  });
});
