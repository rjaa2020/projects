import sys
print('Python executable:', sys.executable)
try:
    import torch
    print('torch version:', torch.__version__)
    try:
        print('cuda_available:', torch.cuda.is_available())
    except Exception as e:
        print('cuda check error:', e)
    try:
        mps = getattr(torch.backends, 'mps', None) is not None and torch.backends.mps.is_available()
        print('mps_available:', mps)
    except Exception as e:
        print('mps check error:', e)
except Exception as e:
    print('torch import failed:', e)

import subprocess
try:
    out = subprocess.check_output(['nvidia-smi','-L'], stderr=subprocess.STDOUT, text=True)
    print('nvidia-smi output:')
    print(out)
except Exception as e:
    print('nvidia-smi not available or error:', e)
