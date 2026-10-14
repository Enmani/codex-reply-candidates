"""Write generated ASAR packaging metadata into the private runtime copy."""
import json
import sys
from pathlib import Path
import pefile

runtime = Path(sys.argv[1]).resolve()
target = (runtime / 'ChatGPT.exe').resolve()
target.relative_to(runtime)
metadata = Path(sys.argv[2]).read_bytes()
new_entries = json.loads(metadata)
if len(new_entries) != 1 or new_entries[0]['file'] != r'resources\app.asar':
    raise ValueError('Unexpected packaging metadata')
pe = pefile.PE(str(target), fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
matches = []
for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
    if str(kind.name).upper() != 'INTEGRITY':
        continue
    for member in kind.directory.entries:
        if str(member.name).upper() == 'ELECTRONASAR':
            matches.extend(language.data.struct for language in member.directory.entries)
if len(matches) != 1:
    raise ValueError('Expected one Electron packaging metadata resource')
resource = matches[0]
if len(metadata) != resource.Size:
    raise ValueError('Packaging metadata has changed size; use a full resource packager')
pe.set_bytes_at_offset(pe.get_offset_from_rva(resource.OffsetToData), metadata)
pe.write(str(target))
pe.close()
print('Updated private runtime packaging metadata')
