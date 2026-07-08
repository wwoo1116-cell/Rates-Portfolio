import openpyxl
wb = openpyxl.load_workbook('True Data.xlsx', read_only=True, data_only=True)
ws = wb.worksheets[0]
for r, row in enumerate(ws.iter_rows(values_only=True, max_row=5)):
    print(f"--- ROW {r} ---")
    for c, val in enumerate(row):
        if val is not None:
            print(f"Col {c}: {val}")
