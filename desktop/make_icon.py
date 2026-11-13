"""Write grainfall.ico (used by the Windows build) from the icon drawn in code."""
from grainfall.app import make_icon_image

make_icon_image(256).save("grainfall.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote grainfall.ico")
