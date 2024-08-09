import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import Select

data = pd.read_excel("CarsLookup.xlsx")


def clear_field(element: WebElement) -> None:
	element.send_keys(Keys.CONTROL + "a")
	element.send_keys(Keys.DELETE)


driver = webdriver.Chrome()
driver.get("https://www.edmunds.com/tco.html")

source = driver.page_source
driver.implicitly_wait(0.5)

car_models = data[["Make", "Year", "Model", "Style"]]
zip = 98004

for index, model in car_models.iterrows():
	print(car_models)
	zip_input = driver.find_element(by=By.NAME, value="zip-input")
	clear_field(zip_input)
	zip_input.send_keys(zip)

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

	source = driver.page_source
	soup = BeautifulSoup(source)

	cash_price = soup.find('p', class_="pricing-value heading-2 mb-0").text

	costs_table = soup.find("table", {'class': "costs-table"})
	table = pd.read_html(str(costs_table), header=0)[0]
	totals = pd.concat([table.iloc[:, 0], table.iloc[:, 6]], axis=1)
	totals.rename(columns={"Unnamed: 0": "Cost", "Total": "Total"}, inplace=True)

	print(totals)

# time.sleep(3)
# driver.quit()

#%%

data.query(f"Make == '{model.Make}' & Year == {model.Year} & Model == '{model.Model}' & Style == "
           f"'{model.Style}'")