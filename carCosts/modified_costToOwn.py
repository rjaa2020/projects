import re

import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import Select

# Load the Excel file
file_path = "CarsLookup.xlsx"
data = pd.read_excel(file_path)

# Define a function to clear input fields
def clear_field(element: WebElement) -> None:
    element.send_keys(Keys.CONTROL + "a")
    element.send_keys(Keys.DELETE)

# Initialize the web driver
driver = webdriver.Chrome()
driver.get("https://www.edmunds.com/tco.html")

# Set implicit wait time
driver.implicitly_wait(0.5)

# Extract car models information
car_models = data[["Make", "Year", "Model", "Style"]]
zip_code = 98004

# Initialize an empty DataFrame to store the results
results = pd.DataFrame(columns=data.columns)

# Iterate over each car model and extract data
for index, model in car_models.iterrows():
    zip_input = driver.find_element(by=By.NAME, value="zip-input")
    clear_field(zip_input)
    zip_input.send_keys(zip_code)

    make_dropdown = Select(driver.find_element(by=By.NAME, value='select-make'))
    make_dropdown.select_by_visible_text(model.Make)

    year_dropdown = Select(driver.find_element(by=By.NAME, value='select-year'))
    year_dropdown.select_by_visible_text(str(model.Year))

    model_dropdown = Select(driver.find_element(by=By.NAME, value='select-model'))
    model_dropdown.select_by_visible_text(model.Model)

    style_dropdown = Select(driver.find_element(by=By.NAME, value='select-style'))
    style_dropdown.select_by_visible_text(model.Style)

    go_button = driver.find_element(by=By.CLASS_NAME, value='go-btn')
    go_button.click()

    # Parse the page source with BeautifulSoup
    source = driver.page_source
    soup = BeautifulSoup(source, 'html.parser')

    # Extract the cash price and costs table
    cash_price = soup.find('p', class_="pricing-value heading-2 mb-0").text

    costs_table = soup.find("table", {'class': "costs-table"})
    table = pd.read_html(str(costs_table), header=0)[0]
    totals = pd.concat([table.iloc[:, 0], table.iloc[:, 6]], axis=1)
    totals.rename(columns={"Unnamed: 0": "Cost", "Total": "Total"}, inplace=True)

    # Add the extracted data to the results DataFrame
    model_data = {
        "Make": model.Make,
        "Year": model.Year,
        "Model": model.Model,
        "Style": model.Style,
        "True Cost to Own": totals.loc[totals['Cost'] == 'True Cost to Own®', 'Total'].values[0] if 'True Cost to Own®' in totals['Cost'].values else None,
        "Total Cash Price": re.sub(r'[^$,0-9.]', '', cash_price),
        "Insurance": totals.loc[totals['Cost'] == 'Insurance', 'Total'].values[0] if 'Insurance' in totals['Cost'].values else None,
        "Maintenance": totals.loc[totals['Cost'] == 'Maintenance', 'Total'].values[0] if 'Maintenance' in totals['Cost'].values else None,
        "Repairs": totals.loc[totals['Cost'] == 'Repairs', 'Total'].values[0] if 'Repairs' in totals['Cost'].values else None,
        "Taxes & Fees": totals.loc[totals['Cost'] == 'Taxes & Fees', 'Total'].values[0] if 'Taxes & Fees' in totals['Cost'].values else None,
        "Financing": totals.loc[totals['Cost'] == 'Financing', 'Total'].values[0] if 'Financing' in totals['Cost'].values else None,
        "Depreciation": totals.loc[totals['Cost'] == 'Depreciation', 'Total'].values[0] if 'Depreciation' in totals['Cost'].values else None,
        "Fuel": totals.loc[totals['Cost'] == 'Fuel', 'Total'].values[0] if 'Fuel' in totals['Cost'].values else None
    }

    model_data_Series = pd.Series(model_data)
    model_data_Series.name = "Series"

    results = results.join(model_data_Series)

# Save the results back to the Excel file
results.to_excel("results.xlsx", index=False)

# Close the driver
driver.quit()

# %%